import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, Page, Cookie } from "puppeteer-core";
import { loadCookies } from "./auth.js";
import { findChromePath } from "./chrome-finder.js";
import type { ProfileData, PostData, ExperienceEntry, EducationEntry, RecommendationEntry, MessageEntry } from "./types.js";
import * as log from "./logger.js";

puppeteer.use(StealthPlugin());

// Maximum number of posts to collect per profile.
const MAX_POSTS = 10;

// How many times to scroll down on the activity page to trigger lazy loading.
const SCROLL_PASSES = 3;

// Selectors for the profile header.
// LinkedIn changes class names periodically — adjust here if extraction breaks.
const HEADER_SELECTORS = {
  name: "h1",
  headline: ".text-body-medium.break-words",
  location: ".pb2.pv-text-details__left-panel .text-body-small",
};

// Selectors for the activity/posts page.
const POST_CONTAINER_SELECTOR = ".feed-shared-update-v2";

// Anchor IDs for profile sections — more stable than class names.
const ABOUT_ANCHOR = "#about";
const EXPERIENCE_ANCHOR = "#experience";
const EDUCATION_ANCHOR = "#education";
const RECOMMENDATIONS_ANCHOR = "#recommendations";

async function extractAbout(page: Page): Promise<string | null> {
  try {
    // Try clicking the "see more" button inside the About section to expand truncated text.
    const seeMoreClicked = await page.evaluate((anchor) => {
      const section = document.querySelector(anchor)?.closest("section") ??
        document.querySelector(`${anchor} ~ * section`) ??
        document.getElementById("about")?.parentElement?.nextElementSibling as Element | null;
      const btn = section?.querySelector("button[aria-label*='see more'], button.inline-show-more-text__button");
      if (btn instanceof HTMLElement) {
        btn.click();
        return true;
      }
      return false;
    }, ABOUT_ANCHOR);

    log.debug("about", `"See more" button ${seeMoreClicked ? "found and clicked" : "not found (text may be truncated)"}`);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const result = await page.evaluate((anchor) => {
      const anchorEl = document.getElementById("about");
      const section = anchorEl?.closest("section");
      if (!section) return { text: null, matchedSelector: null, sectionHtml: null as string | null };

      const candidates: Array<[string, Element | null]> = [
        [".pv-shared-text-with-see-more span[aria-hidden='true']", section.querySelector(".pv-shared-text-with-see-more span[aria-hidden='true']")],
        [".pv-shared-text-with-see-more", section.querySelector(".pv-shared-text-with-see-more")],
        [".inline-show-more-text", section.querySelector(".inline-show-more-text")],
        [".display-flex.full-width span[aria-hidden='true']", section.querySelector(".display-flex.full-width span[aria-hidden='true']")],
      ];

      for (const [sel, el] of candidates) {
        if (el) return { text: el.textContent?.trim() ?? null, matchedSelector: sel, sectionHtml: section.innerHTML };
      }
      return { text: null, matchedSelector: null, sectionHtml: section.innerHTML };
    }, ABOUT_ANCHOR);

    if (result.matchedSelector) {
      log.info("about", `Text found via selector: "${result.matchedSelector}" (${result.text?.length ?? 0} chars)`);
    } else {
      log.error("about", "No text selector matched in About section");
      if (result.sectionHtml) {
        log.dumpHtml("about", "section", result.sectionHtml);
      }
    }

    return result.text;
  } catch (err) {
    log.error("about", `Exception: ${String(err)}`);
    return null;
  }
}

async function extractExperience(page: Page): Promise<ExperienceEntry[]> {
  try {
    const result = await page.evaluate(() => {
      const anchorEl = document.getElementById("experience");
      const section = anchorEl?.closest("section");
      if (!section) return { entries: [], itemCount: 0, sectionFound: false, sectionHtml: null as string | null };

      const items = Array.from(section.querySelectorAll("li.artdeco-list__item"));
      const entries = items.slice(0, 5).map((item) => {
        const spans = Array.from(item.querySelectorAll("span[aria-hidden='true']")).map(
          (el) => el.textContent?.trim() ?? ""
        ).filter(Boolean);

        const title = spans[0] ?? null;
        const company = spans[1] ?? null;
        const dateRange = spans.find((s) => s.includes("·") || /\d{4}/.test(s)) ?? null;
        const description = spans.find(
          (s) => s !== title && s !== company && s !== dateRange && s.length > 30
        ) ?? null;

        return { title, company, dateRange, description };
      });

      return { entries, itemCount: items.length, sectionFound: true, sectionHtml: items.length === 0 ? section.innerHTML : null };
    });

    if (!result.sectionFound) {
      log.error("experience", "Experience section (#experience anchor) not found in DOM");
    } else if (result.itemCount === 0) {
      log.error("experience", "Experience section found but no li.artdeco-list__item items");
      if (result.sectionHtml) log.dumpHtml("experience", "section", result.sectionHtml);
    } else {
      log.info("experience", `Found ${result.itemCount} item(s), returning ${result.entries.length}`);
    }

    return result.entries;
  } catch (err) {
    log.error("experience", `Exception: ${String(err)}`);
    return [];
  }
}

async function extractEducation(page: Page): Promise<EducationEntry[]> {
  try {
    const result = await page.evaluate(() => {
      const anchorEl = document.getElementById("education");
      const section = anchorEl?.closest("section");
      if (!section) return { entries: [], itemCount: 0, sectionFound: false, sectionHtml: null as string | null };

      const items = Array.from(section.querySelectorAll("li.artdeco-list__item"));
      const entries = items.slice(0, 4).map((item) => {
        const spans = Array.from(item.querySelectorAll("span[aria-hidden='true']")).map(
          (el) => el.textContent?.trim() ?? ""
        ).filter(Boolean);

        const school = spans[0] ?? null;
        const degree = spans[1] ?? null;
        const dateRange = spans.find((s) => /\d{4}/.test(s) && s !== school && s !== degree) ?? null;

        return { school, degree, dateRange };
      });

      return { entries, itemCount: items.length, sectionFound: true, sectionHtml: items.length === 0 ? section.innerHTML : null };
    });

    if (!result.sectionFound) {
      log.error("education", "Education section (#education anchor) not found in DOM");
    } else if (result.itemCount === 0) {
      log.error("education", "Education section found but no li.artdeco-list__item items");
      if (result.sectionHtml) log.dumpHtml("education", "section", result.sectionHtml);
    } else {
      log.info("education", `Found ${result.itemCount} item(s), returning ${result.entries.length}`);
    }

    return result.entries;
  } catch (err) {
    log.error("education", `Exception: ${String(err)}`);
    return [];
  }
}

async function extractRecommendations(page: Page): Promise<RecommendationEntry[]> {
  try {
    // Ensure the "Received" tab is active before reading items.
    // LinkedIn shows two tabs (Received / Given) inside the recommendations section.
    await page.evaluate(() => {
      const anchorEl = document.getElementById("recommendations");
      const section = anchorEl?.closest("section");
      if (!section) return;

      const tabs = Array.from(section.querySelectorAll("[role='tab'], button"));
      const receivedTab = tabs.find((t) =>
        t.textContent?.toLowerCase().includes("received")
      );
      if (receivedTab instanceof HTMLElement) {
        receivedTab.click();
      }
    });

    // Short wait for the tab content to render after the click.
    await new Promise((resolve) => setTimeout(resolve, 600));

    // Try expanding any truncated recommendation texts.
    await page.evaluate(() => {
      const anchorEl = document.getElementById("recommendations");
      const section = anchorEl?.closest("section");
      if (!section) return;

      const btns = Array.from(
        section.querySelectorAll("button[aria-label*='see more'], button.inline-show-more-text__button")
      );
      btns.forEach((b) => {
        if (b instanceof HTMLElement) b.click();
      });
    });

    await new Promise((resolve) => setTimeout(resolve, 400));

    const result = await page.evaluate(() => {
      const anchorEl = document.getElementById("recommendations");
      const section = anchorEl?.closest("section");
      if (!section) {
        return { entries: [], itemCount: 0, sectionFound: false, sectionHtml: null as string | null };
      }

      const items = Array.from(section.querySelectorAll("li.artdeco-list__item"));

      const entries = items.slice(0, 5).map((item) => {
        const spans = Array.from(item.querySelectorAll("span[aria-hidden='true']"))
          .map((el) => el.textContent?.trim() ?? "")
          .filter(Boolean);

        // Recommendation body text is usually the longest span.
        const bodyText = spans.reduce(
          (longest, s) => (s.length > longest.length ? s : longest),
          ""
        );

        // The recommender name is typically the first span.
        const recommenderName = spans[0] ?? null;
        // The headline tends to be the second span.
        const recommenderHeadline = spans[1] ?? null;
        // Relationship context is a shorter span that is not the name, headline, or body.
        const relationship =
          spans.find(
            (s) =>
              s !== recommenderName &&
              s !== recommenderHeadline &&
              s !== bodyText &&
              s.length < 80
          ) ?? null;

        return {
          recommenderName,
          recommenderHeadline,
          relationship,
          text: bodyText.length > 0 ? bodyText : null,
        };
      });

      return {
        entries,
        itemCount: items.length,
        sectionFound: true,
        sectionHtml: items.length === 0 ? section.innerHTML : null,
      };
    });

    if (!result.sectionFound) {
      log.error("recommendations", "Recommendations section (#recommendations anchor) not found in DOM");
    } else if (result.itemCount === 0) {
      log.error("recommendations", "Recommendations section found but no li.artdeco-list__item items");
      if (result.sectionHtml) log.dumpHtml("recommendations", "section", result.sectionHtml);
    } else {
      log.info("recommendations", `Found ${result.itemCount} item(s), returning ${result.entries.length}`);
    }

    return result.entries;
  } catch (err) {
    log.error("recommendations", `Exception: ${String(err)}`);
    return [];
  }
}

const MAX_MESSAGES = 10;

async function closeAllMessageOverlays(page: Page): Promise<number> {
  const bubbles = await page.$$(".msg-overlay-conversation-bubble, .msg-convo-wrapper");
  let count = 0;

  for (const bubble of bubbles) {
    // Use evaluateHandle to locate the close button inside this specific bubble element,
    // then use Puppeteer's native click() so browser events fire properly.
    const closeBtnHandle = await bubble.evaluateHandle((el) => {
      // Strategy 1: button that wraps the close-small SVG icon (matches current LinkedIn DOM).
      const bySvg = el.querySelector("svg[data-test-icon='close-small']")?.closest("button");
      if (bySvg instanceof HTMLElement) return bySvg;
      // Strategy 2: any button inside the header controls bar whose text contains "Close".
      const ctrlBtns = Array.from(el.querySelectorAll(".msg-overlay-bubble-header__controls button"));
      const byText = ctrlBtns.find((b) => b.textContent?.toLowerCase().includes("close"));
      if (byText instanceof HTMLElement) return byText;
      // Strategy 3: aria-label fallback for future LinkedIn DOM changes.
      return el.querySelector("button[aria-label*='Close'], button[aria-label*='close']") ?? null;
    });

    const closeBtnEl = closeBtnHandle.asElement() as import("puppeteer").ElementHandle<Element> | null;
    if (closeBtnEl) {
      try {
        await closeBtnEl.click();
        count++;
      } catch {
        // Element may have already detached from the DOM; safe to ignore.
      }
    }
    await closeBtnHandle.dispose();
  }

  if (count > 0) {
    // Wait until all overlay bubbles are gone from the DOM to confirm the closes took effect.
    try {
      await page.waitForFunction(
        () => document.querySelectorAll(".msg-overlay-conversation-bubble, .msg-convo-wrapper").length === 0,
        { timeout: 5_000 }
      );
    } catch {
      // Overlays may still be present after timeout; caller logs and continues.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return count;
}

async function getLoggedInUserName(page: Page): Promise<string> {
  try {
    const name = await page.evaluate(() => {
      // Most reliable: the nav profile photo alt text is "Photo of Full Name".
      const photoAlt =
        (document.querySelector("img.global-nav__me-photo") as HTMLImageElement | null)?.alt ??
        (document.querySelector(".global-nav__me-photo") as HTMLImageElement | null)?.alt ??
        null;
      if (photoAlt) {
        // Strip leading "Photo of " prefix LinkedIn adds.
        const parsed = photoAlt.replace(/^photo of\s+/i, "").trim();
        if (parsed) return parsed;
      }

      // Fallback: text elements inside the "Me" nav section.
      return (
        document.querySelector(".global-nav__me .t-normal")?.textContent?.trim() ??
        document.querySelector(".global-nav__me .global-nav__primary-link-text")?.textContent?.trim() ??
        // Last resort: aria-label on the nav profile link.
        document.querySelector("a[href*='/in/'][aria-label]")?.getAttribute("aria-label")?.trim() ??
        ""
      );
    });
    return name;
  } catch {
    return "";
  }
}

async function scrapeMessages(
  page: Page,
  loggedInName: string,
  expectedName: string | null = null
): Promise<MessageEntry[]> {
  log.info("messages", `Starting message scrape (logged-in name: "${loggedInName || "(unknown)"}")`);
  try {
    // Close any pre-existing messaging panels to start from a clean state.
    const closedCount = await closeAllMessageOverlays(page);
    log.debug("messages", `Pre-existing overlays closed: ${closedCount}`);

    // Capture current page DOM for reference before clicking Message button.
    const allButtons = await page.evaluate(() =>
      Array.from(document.querySelectorAll("button"))
        .map((b) => ({ text: b.textContent?.trim() ?? "", ariaLabel: b.getAttribute("aria-label") ?? "" }))
        .filter((b) => b.text || b.ariaLabel)
        .slice(0, 30)
    );
    log.debug("messages", `Visible buttons on profile page: ${JSON.stringify(allButtons)}`);

    // Click the "Message" button on the profile page.
    const clickResult = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      const byText = buttons.find((b) => b.textContent?.trim() === "Message");
      if (byText) {
        byText.click();
        return { clicked: true, strategy: "text-match", html: byText.outerHTML };
      }
      const byAria = buttons.find((b) => b.getAttribute("aria-label")?.toLowerCase().includes("message"));
      if (byAria) {
        byAria.click();
        return { clicked: true, strategy: "aria-label", html: byAria.outerHTML };
      }
      const link = document.querySelector("a[href*='messaging']") as HTMLElement | null;
      if (link) {
        link.click();
        return { clicked: true, strategy: "messaging-link", html: link.outerHTML };
      }
      return { clicked: false, strategy: "none", html: null };
    });

    if (!clickResult.clicked) {
      log.error("messages", "Message button not found on profile page — no text-match, aria-label, or messaging link");
      // Dump full page HTML to diagnose what elements are actually present.
      const bodyHtml = await page.evaluate(() => document.body.innerHTML);
      log.dumpHtml("messages", "profile-page-body", bodyHtml);
      return [];
    }

    log.info("messages", `Message button clicked via strategy: "${clickResult.strategy}" — element: ${clickResult.html}`);

    // Take a screenshot immediately after clicking to capture any animation/transition.
    try {
      const screenshotBuf = await page.screenshot({ fullPage: false });
      log.saveScreenshot("messages", "after-click", screenshotBuf as Buffer);
    } catch (ssErr) {
      log.debug("messages", `Screenshot after click failed: ${String(ssErr)}`);
    }

    // Wait for the messaging overlay to appear.
    const OVERLAY_SELECTORS =
      ".msg-overlay-conversation-bubble, .msg-convo-wrapper, .msg-s-message-list, " +
      ".msg-overlay-list-bubble, .msg-s-message-list-content";

    try {
      await page.waitForSelector(OVERLAY_SELECTORS, { timeout: 10_000 });
      log.info("messages", "Messaging overlay appeared");
    } catch (waitErr) {
      log.error("messages", `Messaging overlay did not appear within 10s: ${String(waitErr)}`);
      try {
        const screenshotBuf = await page.screenshot({ fullPage: false });
        log.saveScreenshot("messages", "overlay-timeout", screenshotBuf as Buffer);
        const bodyHtml = await page.evaluate(() => document.body.innerHTML);
        log.dumpHtml("messages", "overlay-timeout-body", bodyHtml);
      } catch {
        // ignore screenshot/dump errors in error handler
      }
      return [];
    }

    // Give messages time to fully render.
    await new Promise((resolve) => setTimeout(resolve, 2_500));

    // Screenshot before extraction.
    try {
      const screenshotBuf = await page.screenshot({ fullPage: false });
      log.saveScreenshot("messages", "before-extraction", screenshotBuf as Buffer);
    } catch (ssErr) {
      log.debug("messages", `Screenshot before extraction failed: ${String(ssErr)}`);
    }

    // Validate that the overlay showing is for the expected person, not a stale conversation.
    // This guards against the case where closeAllMessageOverlays failed on a previous profile.
    if (expectedName) {
      const overlayPersonName = await page.evaluate(() => {
        const activeOverlay =
          document.querySelector(".msg-overlay-conversation-bubble--is-active") ??
          document.querySelector(".msg-overlay-conversation-bubble:last-child");
        return activeOverlay?.querySelector(".msg-overlay-bubble-header__title")?.textContent?.trim() ?? null;
      });

      if (overlayPersonName) {
        const normalize = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
        const expectedFirst = normalize(expectedName.split(" ")[0]);
        if (expectedFirst && !normalize(overlayPersonName).includes(expectedFirst)) {
          log.error("messages",
            `Stale overlay detected — shows "${overlayPersonName}" but expected "${expectedName}". ` +
            `Closing all overlays and skipping message extraction to prevent cross-contamination.`
          );
          await closeAllMessageOverlays(page);
          return [];
        }
        log.debug("messages", `Overlay name "${overlayPersonName}" matches expected "${expectedName}" ✓`);
      }
    }

    // Detailed DOM snapshot — counts and full overlay HTML dump.
    const overlayDiag = await page.evaluate(() => {
      const overlayEl =
        document.querySelector(".msg-overlay-conversation-bubble") ??
        document.querySelector(".msg-s-message-list-content") ??
        document.querySelector(".msg-s-message-list") ??
        document.querySelector(".msg-convo-wrapper");
      return {
        groups: document.querySelectorAll(".msg-s-message-group").length,
        events: document.querySelectorAll(".msg-s-event-listitem").length,
        list: document.querySelectorAll(".msg-s-message-list, .msg-s-message-list-content").length,
        bubble: document.querySelectorAll(".msg-overlay-conversation-bubble").length,
        overlayHtml: overlayEl?.innerHTML ?? null,
        overlayOuterHtml: overlayEl?.outerHTML?.slice(0, 500) ?? null,
      };
    });

    log.debug("messages",
      `DOM snapshot — groups:${overlayDiag.groups} events:${overlayDiag.events} ` +
      `list:${overlayDiag.list} bubble:${overlayDiag.bubble}`
    );
    log.debug("messages", `Overlay root element (first 500 chars): ${overlayDiag.overlayOuterHtml ?? "(none found)"}`);

    if (overlayDiag.overlayHtml) {
      log.dumpHtml("messages", "overlay-content", overlayDiag.overlayHtml);
    } else {
      log.error("messages", "No overlay container element found to dump — dumping full body");
      const bodyHtml = await page.evaluate(() => document.body.innerHTML);
      log.dumpHtml("messages", "full-body-no-overlay", bodyHtml);
    }

    // Extract messages from the conversation thread.
    // IMPORTANT: Scope all queries to the ACTIVE overlay bubble only, to avoid picking up
    // messages from any stale overlays that were not properly closed.
    // Use arrow functions (not `function` declarations) inside page.evaluate()
    // because tsx/esbuild wraps named functions with __name() which doesn't exist in the browser context.
    const extractionResult = await page.evaluate((myName: string) => {
      // Find the active/most-recent overlay bubble to scope all queries.
      const activeBubble =
        document.querySelector(".msg-overlay-conversation-bubble--is-active") ??
        document.querySelector(".msg-overlay-conversation-bubble:last-child") ??
        document.querySelector(".msg-convo-wrapper:last-child") ??
        document;

      const isSelfGroup = (group: Element): boolean => {
        if (
          group.classList.contains("msg-s-message-group--self") ||
          group.classList.contains("msg-s-message-group--outgoing") ||
          group.closest("[class*='--self']") !== null ||
          group.closest("[class*='--outgoing']") !== null
        ) {
          return true;
        }

        if (myName) {
          const senderEl = group.querySelector(
            ".msg-s-message-group__name, " +
            ".msg-s-message-group__profile-link, " +
            ".msg-s-message-group__meta .t-14"
          );
          const senderName = senderEl?.textContent?.trim() ?? "";
          if (senderName) {
            const normalize = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
            const myFirst = normalize(myName.split(" ")[0]);
            if (myFirst && normalize(senderName).includes(myFirst)) {
              return true;
            }
          }
        }

        const style = window.getComputedStyle(group);
        if (
          style.textAlign === "right" ||
          style.justifyContent === "flex-end" ||
          style.alignItems === "flex-end"
        ) {
          return true;
        }

        return false;
      };

      const groups = Array.from(activeBubble.querySelectorAll(".msg-s-message-group"));

      if (groups.length === 0) {
        const events = Array.from(activeBubble.querySelectorAll(".msg-s-event-listitem"));

        const messages = events.map((event) => {
          const parentGroup = event.closest(".msg-s-message-group") ?? event;
          const isSelf = isSelfGroup(parentGroup);
          const bodyEl =
            event.querySelector(".msg-s-event-listitem__body") ??
            event.querySelector(".msg-s-event-listitem__message-bubble") ??
            event.querySelector("p");
          const timeEl = event.querySelector("time");
          return {
            sender: isSelf ? ("self" as const) : ("them" as const),
            text: bodyEl?.textContent?.trim() ?? "",
            timestamp: timeEl?.getAttribute("datetime") ?? timeEl?.textContent?.trim() ?? null,
          };
        }).filter((m) => m.text.length > 0);

        return { messages, groupCount: 0, eventCount: events.length, usedFallback: true };
      }

      const result: Array<{ sender: "self" | "them"; text: string; timestamp: string | null }> = [];
      for (const group of groups) {
        const isSelf = isSelfGroup(group);
        const timeEl = group.querySelector("time");
        const timestamp = timeEl?.getAttribute("datetime") ?? timeEl?.textContent?.trim() ?? null;

        const msgItems = Array.from(
          group.querySelectorAll(
            ".msg-s-event-listitem__body, " +
            ".msg-s-message-group__msg p, " +
            ".msg-s-event-listitem__message-bubble"
          )
        );

        for (const item of msgItems) {
          const text = item.textContent?.trim() ?? "";
          if (text.length > 0) {
            result.push({ sender: isSelf ? "self" : "them", text, timestamp });
          }
        }
      }
      return { messages: result, groupCount: groups.length, eventCount: 0, usedFallback: false };
    }, loggedInName);

    log.info("messages",
      `Extraction complete — groupCount:${extractionResult.groupCount} ` +
      `eventCount:${extractionResult.eventCount} ` +
      `usedFallback:${extractionResult.usedFallback} ` +
      `rawMessages:${extractionResult.messages.length}`
    );

    if (extractionResult.messages.length === 0) {
      log.error("messages", "Zero messages extracted — check HTML dump for selector mismatches");
    } else {
      log.debug("messages", `Raw messages: ${JSON.stringify(extractionResult.messages)}`);
    }

    // Close the messaging overlay after extraction.
    const postClosedCount = await closeAllMessageOverlays(page);
    log.debug("messages", `Post-extraction overlays closed: ${postClosedCount}`);

    const final = extractionResult.messages.slice(-MAX_MESSAGES);
    log.info("messages", `Returning ${final.length} message(s) (capped at ${MAX_MESSAGES})`);
    return final;
  } catch (err) {
    log.error("messages", `Unhandled exception in scrapeMessages: ${String(err)}`);
    if (err instanceof Error && err.stack) {
      log.error("messages", `Stack trace: ${err.stack}`);
    }
    try {
      const screenshotBuf = await page.screenshot({ fullPage: false });
      log.saveScreenshot("messages", "exception", screenshotBuf as Buffer);
    } catch {
      // ignore screenshot failure inside error handler
    }
    return [];
  }
}

function activityUrl(profileUrl: string): string {
  return profileUrl.replace(/\/$/, "") + "/recent-activity/shares/";
}

async function extractText(
  page: Page,
  selector: string
): Promise<string | null> {
  try {
    await page.waitForSelector(selector, { timeout: 8_000 });
    const text = await page.$eval(
      selector,
      (el) => el.textContent?.trim() ?? null
    );
    return text ?? null;
  } catch {
    return null;
  }
}

async function scrollToLoadContent(page: Page, passes: number): Promise<void> {
  for (let i = 0; i < passes; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
    // Wait for newly rendered content after each scroll.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  // Return to top so the full page is in a consistent state.
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function scrapePosts(page: Page, profileUrl: string): Promise<PostData[]> {
  const url = activityUrl(profileUrl);
  log.info("posts", `Fetching activity page: ${url}`);

  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });

    try {
      await page.waitForSelector(POST_CONTAINER_SELECTOR, { timeout: 12_000 });
      log.info("posts", `Post container "${POST_CONTAINER_SELECTOR}" found`);
    } catch (waitErr) {
      log.error("posts", `No post containers found within 12s (selector: "${POST_CONTAINER_SELECTOR}"): ${String(waitErr)}`);
      const bodyHtml = await page.evaluate(() => document.body.innerHTML);
      log.dumpHtml("posts", "activity-page-no-posts", bodyHtml);
      return [];
    }

    await scrollToLoadContent(page, SCROLL_PASSES);

    const posts: PostData[] = await page.$$eval(
      POST_CONTAINER_SELECTOR,
      (cards) =>
        cards.map((card) => {
          const textEl =
            card.querySelector(".feed-shared-text span[dir='ltr']") ||
            card.querySelector(".feed-shared-text") ||
            card.querySelector(".update-components-text span[dir='ltr']") ||
            card.querySelector(".update-components-text");

          const dateEl =
            card.querySelector(".update-components-actor__sub-description span:not(.visually-hidden)") ||
            card.querySelector(".feed-shared-actor__sub-description span:not(.visually-hidden)");

          const reactionsEl = card.querySelector(".social-details-social-counts__reactions-count");
          const commentsEl = card.querySelector(".social-details-social-counts__comments-count");

          return {
            text: textEl?.textContent?.trim() ?? null,
            publishedAt: dateEl?.textContent?.trim() ?? null,
            reactionsCount: reactionsEl?.textContent?.trim() ?? null,
            commentsCount: commentsEl?.textContent?.trim() ?? null,
          };
        })
    );

    log.debug("posts", `Raw cards extracted: ${posts.length}, cards with no text: ${posts.filter((p) => !p.text).length}`);

    const filtered = posts
      .filter((p) => p.text !== null && p.text.length > 0)
      .slice(0, MAX_POSTS);

    log.info("posts", `Returning ${filtered.length} post(s) after filtering (MAX_POSTS=${MAX_POSTS})`);
    return filtered;
  } catch (err) {
    log.error("posts", `Exception in scrapePosts: ${String(err)}`);
    return [];
  }
}

export async function scrapeProfiles(urls: string[]): Promise<ProfileData[]> {
  log.info("scraper", `Starting scrape for ${urls.length} profile(s)`);
  urls.forEach((u, i) => log.debug("scraper", `  [${i + 1}] ${u}`));

  const cookies = loadCookies() as Cookie[];
  log.debug("scraper", `Loaded ${cookies.length} cookie(s) from session file`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const browser: Browser = await (puppeteer as any).launch({
    headless: false,
    defaultViewport: null,
    executablePath: findChromePath(),
    args: ["--start-maximized"],
  });

  log.info("scraper", "Browser launched");
  const results: ProfileData[] = [];

  try {
    const page: Page = await browser.newPage();

    // Polyfill esbuild's __name decorator in the browser context.
    // tsx/esbuild injects __name() calls around named functions and const-assigned
    // arrow functions, but __name doesn't exist inside the browser used by page.evaluate().
    // This must run before any page.evaluate() call that contains named constructs.
    await page.evaluateOnNewDocument(`window.__name = (target) => target`);

    await page.setCookie(...cookies);
    log.debug("scraper", "Cookies applied to page");

    let loggedInName: string | null = null;

    for (const url of urls) {
      const profileStart = Date.now();
      log.info("scraper", `\n--- Scraping profile: ${url} ---`);

      // Close any overlays that survived from the previous profile before navigating.
      // LinkedIn's messaging widget persists through SPA navigations, so we must
      // explicitly close any open conversations to prevent stale message extraction.
      const staleCount = await closeAllMessageOverlays(page);
      if (staleCount > 0) {
        log.debug("scraper", `Closed ${staleCount} stale overlay(s) before profile navigation`);
      }

      // --- Profile header ---
      let t = Date.now();
      await page.goto(url, { waitUntil: "domcontentloaded" });

      const landedUrl = page.url();
      if (
        landedUrl.includes("/login") ||
        landedUrl.includes("/checkpoint") ||
        landedUrl.includes("/authwall")
      ) {
        throw new Error("SESSION_EXPIRED");
      }

      await page.waitForSelector(HEADER_SELECTORS.name, { timeout: 15_000 });
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      log.debug("scraper", `Profile page loaded in ${Date.now() - t}ms`);

      const name = await extractText(page, HEADER_SELECTORS.name);
      const headline = await extractText(page, HEADER_SELECTORS.headline);
      const location = await extractText(page, HEADER_SELECTORS.location);
      log.info("scraper", `Header — name:"${name}" headline:"${headline}" location:"${location}"`);

      // Scroll to trigger lazy-loading of About / Experience / Education sections.
      t = Date.now();
      await scrollToLoadContent(page, 2);
      log.debug("scraper", `Scroll-to-load completed in ${Date.now() - t}ms`);

      t = Date.now();
      const about = await extractAbout(page);
      log.debug("scraper", `extractAbout: ${about ? `${about.length} chars` : "null"} (${Date.now() - t}ms)`);

      t = Date.now();
      const experience = await extractExperience(page);
      log.debug("scraper", `extractExperience: ${experience.length} entries (${Date.now() - t}ms)`);

      t = Date.now();
      const education = await extractEducation(page);
      log.debug("scraper", `extractEducation: ${education.length} entries (${Date.now() - t}ms)`);

      t = Date.now();
      const recommendations = await extractRecommendations(page);
      log.debug("scraper", `extractRecommendations: ${recommendations.length} entries (${Date.now() - t}ms)`);

      // Resolve logged-in user name from the nav bar on the first profile page.
      if (loggedInName === null) {
        loggedInName = await getLoggedInUserName(page);
        log.info("scraper", `Logged-in user detected as: "${loggedInName || "(unknown)"}"`);
      }

      // --- Existing conversation ---
      t = Date.now();
      const messages = await scrapeMessages(page, loggedInName, name);
      log.info("scraper", `scrapeMessages returned ${messages.length} message(s) (${Date.now() - t}ms)`);

      // --- Posts ---
      t = Date.now();
      const posts = await scrapePosts(page, url);
      log.debug("scraper", `scrapePosts returned ${posts.length} post(s) (${Date.now() - t}ms)`);

      results.push({
        url,
        name,
        headline,
        location,
        about,
        experience,
        education,
        recommendations,
        messages,
        posts,
        scrapedAt: new Date().toISOString(),
      });

      log.info("scraper", `Profile complete in ${Date.now() - profileStart}ms — messages:${messages.length} posts:${posts.length} recommendations:${recommendations.length}`);

      // Polite inter-profile delay.
      if (urls.indexOf(url) < urls.length - 1) {
        const delay = 3_000 + Math.random() * 2_000;
        log.debug("scraper", `Inter-profile delay: ${Math.round(delay)}ms`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  } finally {
    await browser.close();
    log.info("scraper", "Browser closed");
  }

  log.info("scraper", `Scrape complete — ${results.length} profile(s) collected`);
  return results;
}
