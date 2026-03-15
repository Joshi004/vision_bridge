import fs from "fs";
import path from "path";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, Page } from "puppeteer";
import { getCookiesPath } from "./paths.js";

puppeteer.use(StealthPlugin());

const LINKEDIN_LOGIN_URL = "https://www.linkedin.com/login";

export function cookiesExist(): boolean {
  return fs.existsSync(getCookiesPath());
}

export function deleteCookies(): void {
  const p = getCookiesPath();
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

export function loadCookies(): object[] {
  const raw = fs.readFileSync(getCookiesPath(), "utf-8");
  return JSON.parse(raw) as object[];
}

function saveCookies(cookies: object[]): void {
  const cookiesPath = getCookiesPath();
  const dir = path.dirname(cookiesPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2), "utf-8");
}

async function waitForLoggedIn(page: Page, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = page.url();
    if (
      url.includes("/feed") ||
      url.includes("/mynetwork") ||
      (url.includes("/in/") && !url.includes("/login"))
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("Timed out waiting for LinkedIn login to complete.");
}

export async function runLoginFlow(executablePath?: string): Promise<void> {
  console.log("Opening LinkedIn login page...");
  console.log("Please log in manually in the browser window that opens.");
  console.log("The session will be saved once you reach the LinkedIn feed.\n");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const browser: Browser = await (puppeteer as any).launch({
    headless: false,
    defaultViewport: null,
    args: ["--start-maximized"],
    ...(executablePath ? { executablePath } : {}),
  });

  const page: Page = await browser.newPage();
  await page.goto(LINKEDIN_LOGIN_URL, { waitUntil: "domcontentloaded" });

  // Wait for the user to complete login manually by polling the current URL.
  console.log("Waiting for you to log in...");
  await waitForLoggedIn(page, 120_000);

  const cookies = await page.cookies();
  saveCookies(cookies);
  console.log(`\nSession saved to ${getCookiesPath()}`);

  await browser.close();
}
