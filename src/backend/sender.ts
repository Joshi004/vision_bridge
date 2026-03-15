import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Cookie, Page } from "puppeteer-core";
import { loadCookies } from "./auth.js";
import { findChromePath } from "./chrome-finder.js";
import * as log from "./logger.js";
import os from "os";

puppeteer.use(StealthPlugin());

const IS_MAC = os.platform() === "darwin";
const MOD_KEY = IS_MAC ? "Meta" : "Control";

const MSG_INPUT_SELECTORS = [
  ".msg-form__contenteditable",
  ".msg-form__message-texteditor [contenteditable='true']",
  "[contenteditable='true'][role='textbox']",
  ".msg-form__message-texteditor [contenteditable]",
  "div.msg-form__msg-content-container [contenteditable]",
  ".msg-form [contenteditable]",
];

const MSG_SEND_SELECTORS = [
  "button.msg-form__send-button",
  "button.msg-form__send-btn",
  ".msg-form__right-actions button[type='submit']",
  ".msg-form__footer button[type='submit']",
  ".msg-form button[aria-label*='Send']",
  ".msg-form__right-actions button",
  ".msg-form__footer button",
];

async function takeScreenshot(page: Page, label: string): Promise<void> {
  try {
    const buf = await page.screenshot({ fullPage: false });
    log.saveScreenshot("sender", label, buf as Buffer);
  } catch (err) {
    log.debug("sender", `Screenshot "${label}" failed: ${String(err)}`);
  }
}

async function dumpOverlayDom(page: Page): Promise<void> {
  try {
    const diag = await page.evaluate(() => {
      const overlay =
        document.querySelector(".msg-overlay-conversation-bubble") ??
        document.querySelector(".msg-convo-wrapper");

      if (!overlay) return { found: false } as const;

      const allContentEditable = Array.from(overlay.querySelectorAll("[contenteditable]")).map(
        (el) => ({
          tag: el.tagName,
          classes: el.className,
          role: el.getAttribute("role"),
          contenteditable: el.getAttribute("contenteditable"),
        })
      );

      const allButtons = Array.from(overlay.querySelectorAll("button")).map((b) => ({
        text: b.textContent?.trim()?.slice(0, 60) ?? "",
        ariaLabel: b.getAttribute("aria-label") ?? "",
        classes: b.className?.slice(0, 100) ?? "",
        type: b.type,
        disabled: b.disabled,
      }));

      const allInputs = Array.from(overlay.querySelectorAll("input, textarea")).map((el) => ({
        tag: el.tagName,
        type: (el as HTMLInputElement).type,
        classes: el.className,
      }));

      const formElements = Array.from(overlay.querySelectorAll(".msg-form, .msg-form__contenteditable, .msg-form__message-texteditor")).map(
        (el) => ({
          tag: el.tagName,
          classes: el.className,
          childCount: el.children.length,
          innerHTML: el.innerHTML?.slice(0, 300) ?? "",
        })
      );

      return {
        found: true,
        overlayClasses: overlay.className?.slice(0, 200),
        contentEditables: allContentEditable,
        buttons: allButtons,
        inputs: allInputs,
        formElements,
      } as const;
    });

    if (!diag.found) {
      log.error("sender", "DOM dump: no overlay container found in DOM");
      return;
    }

    log.debug("sender", `DOM dump — overlay classes: ${diag.overlayClasses}`);
    log.debug("sender", `DOM dump — contenteditable elements (${diag.contentEditables.length}): ${JSON.stringify(diag.contentEditables)}`);
    log.debug("sender", `DOM dump — buttons (${diag.buttons.length}): ${JSON.stringify(diag.buttons)}`);
    log.debug("sender", `DOM dump — inputs (${diag.inputs.length}): ${JSON.stringify(diag.inputs)}`);
    log.debug("sender", `DOM dump — form elements (${diag.formElements.length}): ${JSON.stringify(diag.formElements)}`);
  } catch (err) {
    log.error("sender", `DOM dump failed: ${String(err)}`);
  }
}

/**
 * Send a LinkedIn direct message to a profile by navigating to their profile
 * page via Puppeteer, opening the messaging overlay, typing the message, and
 * clicking Send.
 *
 * Requires valid LinkedIn session cookies to be present (run `npm run login`
 * first). Throws on any failure so the caller can handle the error.
 */
export async function sendLinkedInMessage(
  linkedinUrl: string,
  messageText: string
): Promise<void> {
  log.init();
  log.info("sender", `Starting send to: ${linkedinUrl}`);
  log.debug("sender", `Message length: ${messageText.length} chars`);
  log.debug("sender", `Platform: ${os.platform()}, modifier key: ${MOD_KEY}`);

  const cookies = loadCookies() as Cookie[];
  log.debug("sender", `Loaded ${cookies.length} cookie(s)`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const browser = await (puppeteer as any).launch({
    headless: false,
    defaultViewport: null,
    executablePath: findChromePath(),
    args: ["--start-maximized"],
  });

  log.info("sender", "Browser launched");

  try {
    const page = await browser.newPage();

    // Polyfill esbuild's __name decorator (same reason as in scraper.ts).
    await page.evaluateOnNewDocument(`window.__name = (target) => target`);

    await page.setCookie(...cookies);
    log.debug("sender", "Cookies applied");

    // Navigate to the target profile.
    await page.goto(linkedinUrl, { waitUntil: "domcontentloaded" });

    const landedUrl = page.url();
    if (
      landedUrl.includes("/login") ||
      landedUrl.includes("/checkpoint") ||
      landedUrl.includes("/authwall")
    ) {
      throw new Error("SESSION_EXPIRED");
    }

    await page.waitForSelector("h1", { timeout: 15_000 });
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    log.info("sender", "Profile page loaded");
    await takeScreenshot(page, "01-profile-loaded");

    // Click the "Message" button using the same multi-strategy approach as the scraper.
    const clickResult = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      const byText = buttons.find((b) => b.textContent?.trim() === "Message");
      if (byText) {
        byText.click();
        return { clicked: true, strategy: "text-match" };
      }
      const byAria = buttons.find((b) =>
        b.getAttribute("aria-label")?.toLowerCase().includes("message")
      );
      if (byAria) {
        byAria.click();
        return { clicked: true, strategy: "aria-label" };
      }
      const link = document.querySelector("a[href*='messaging']") as HTMLElement | null;
      if (link) {
        link.click();
        return { clicked: true, strategy: "messaging-link" };
      }
      return { clicked: false, strategy: "none" };
    });

    if (!clickResult.clicked) {
      await takeScreenshot(page, "error-no-message-button");
      throw new Error(
        "Message button not found on profile page. The profile may not allow direct messages, " +
          "or the session is not logged in."
      );
    }
    log.info("sender", `Message button clicked via strategy: "${clickResult.strategy}"`);

    // Wait for the messaging overlay container to appear.
    const OVERLAY_SELECTORS =
      ".msg-overlay-conversation-bubble, .msg-convo-wrapper";

    try {
      await page.waitForSelector(OVERLAY_SELECTORS, { timeout: 10_000 });
      log.info("sender", "Messaging overlay container detected");
    } catch {
      await takeScreenshot(page, "error-no-overlay");
      throw new Error(
        "Messaging overlay did not appear within 10 seconds. " +
          "The profile may require a connection request before messaging."
      );
    }

    // Wait for the overlay to fully render — the container appears quickly but
    // the message form inside it takes time to mount.
    log.info("sender", "Waiting for message form to render inside overlay...");
    await new Promise((resolve) => setTimeout(resolve, 3_000));

    await takeScreenshot(page, "02-overlay-open");
    await dumpOverlayDom(page);

    // Try to find the message input field, with retries since LinkedIn's form
    // can take a few seconds to fully render after the overlay appears.
    let inputHandle = null;
    let matchedInputSelector: string | null = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      log.debug("sender", `Input search attempt ${attempt}/3...`);

      for (const sel of MSG_INPUT_SELECTORS) {
        const found = await page.$(sel);
        if (found) {
          inputHandle = found;
          matchedInputSelector = sel;
          log.info("sender", `Message input found with selector: "${sel}" (attempt ${attempt})`);
          break;
        }
        log.debug("sender", `  Selector "${sel}" — not found`);
      }

      if (inputHandle) break;

      if (attempt < 3) {
        log.debug("sender", `No input found on attempt ${attempt}, waiting 2s before retry...`);
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        await dumpOverlayDom(page);
      }
    }

    if (!inputHandle || !matchedInputSelector) {
      await takeScreenshot(page, "error-no-input-field");

      // One more diagnostic: dump the full overlay HTML for offline analysis.
      try {
        const overlayHtml = await page.evaluate(() => {
          const el =
            document.querySelector(".msg-overlay-conversation-bubble") ??
            document.querySelector(".msg-convo-wrapper");
          return el?.innerHTML ?? "(no overlay element found)";
        });
        log.dumpHtml("sender", "overlay-no-input", overlayHtml);
      } catch {
        // ignore dump error
      }

      throw new Error(
        "Could not locate the message input field in the messaging overlay after 3 attempts. " +
          "LinkedIn's DOM may have changed. Check the screenshot and HTML dump in the logs folder."
      );
    }

    // Click the input to focus it.
    await inputHandle.click();
    log.debug("sender", "Clicked input to focus");
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Select all and delete any pre-filled content (use Meta on macOS, Control on others).
    await page.keyboard.down(MOD_KEY);
    await page.keyboard.press("KeyA");
    await page.keyboard.up(MOD_KEY);
    await page.keyboard.press("Backspace");
    await new Promise((resolve) => setTimeout(resolve, 300));
    log.debug("sender", "Cleared existing input content");

    // Type the message character by character.
    await page.keyboard.type(messageText, { delay: 20 });
    log.info("sender", `Typed message (${messageText.length} chars)`);

    await takeScreenshot(page, "03-message-typed");

    // Verify the message was actually typed by reading the input content.
    try {
      const typedContent = await page.evaluate((sel: string) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        return el?.innerText?.trim() ?? "";
      }, matchedInputSelector);
      log.debug("sender", `Input content after typing (${typedContent.length} chars): "${typedContent.slice(0, 100)}..."`);

      if (typedContent.length === 0) {
        log.error("sender", "WARNING: Input appears empty after typing — message may not have been entered");
      }
    } catch (err) {
      log.debug("sender", `Could not verify typed content: ${String(err)}`);
    }

    // Give LinkedIn's JS time to register the input and enable the send button.
    await new Promise((resolve) => setTimeout(resolve, 1_000));

    // Dump button state before trying to click send.
    log.debug("sender", "Looking for send button...");
    let sendClicked = false;
    for (const sel of MSG_SEND_SELECTORS) {
      const btn = await page.$(sel);
      if (btn) {
        const btnInfo = await page.evaluate((el: Element) => ({
          text: (el as HTMLButtonElement).textContent?.trim() ?? "",
          disabled: (el as HTMLButtonElement).disabled,
          ariaLabel: el.getAttribute("aria-label") ?? "",
          classes: el.className?.slice(0, 100) ?? "",
        }), btn);
        log.debug("sender", `  Found button at "${sel}": text="${btnInfo.text}" disabled=${btnInfo.disabled} aria="${btnInfo.ariaLabel}" classes="${btnInfo.classes}"`);

        if (!btnInfo.disabled) {
          await btn.click();
          sendClicked = true;
          log.info("sender", `Send button clicked via selector: "${sel}"`);
          break;
        }
        log.debug("sender", `  Button is disabled — trying next selector`);
      } else {
        log.debug("sender", `  Selector "${sel}" — not found`);
      }
    }

    if (!sendClicked) {
      await takeScreenshot(page, "error-no-send-button");
      await dumpOverlayDom(page);
      throw new Error(
        "Send button not found or all matching buttons are disabled. " +
          "The message may not have been typed correctly. Check screenshots in logs folder."
      );
    }

    await takeScreenshot(page, "04-send-clicked");

    // Wait for the input to clear, which confirms the message was sent.
    try {
      await page.waitForFunction(
        (sel: string) => {
          const el = document.querySelector(sel) as HTMLElement | null;
          if (!el) return true;
          const text = el.innerText?.trim() ?? "";
          return text.length === 0;
        },
        { timeout: 8_000 },
        matchedInputSelector
      );
      log.info("sender", "Message sent successfully — input field cleared");
    } catch {
      log.info("sender", "Input did not clear within 8s after send click — treating as sent (best-effort)");
    }

    await takeScreenshot(page, "05-after-send");

    // Brief pause before closing to let any in-flight network requests complete.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    log.info("sender", "Send flow complete");
  } finally {
    await browser.close();
    log.info("sender", "Browser closed");
  }
}
