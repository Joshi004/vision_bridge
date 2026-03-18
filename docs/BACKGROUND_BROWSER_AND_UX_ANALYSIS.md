# Background Browser & Status UX — Analysis

## The Problem

Today, every scrape or send operation launches a **full-size, visible Chrome window** (`headless: false`, `--start-maximized`). This steals focus from the Electron app, breaks the user's flow, and makes the tool feel disjointed. On the UI side, the Compose page shows raw diagnostic logs (timestamps, log levels, component tags) that are useful for debugging but overwhelming for everyday use.

Two things need to change:

1. **Chrome should work in the background** — the user should never see it.
2. **The UI should show clean, human-readable status** — raw logs belong in files, not on screen.

---

## Part 1 — Running Chrome in the Background

### Current Setup

- `puppeteer-extra` + `puppeteer-core` + stealth plugin.
- Each scrape/send launches a **new Chrome process** with `headless: false` and `--start-maximized`.
- LinkedIn cookies are file-based (`cookies.json`), loaded into each Puppeteer page.
- Three entry points: `scraper.ts`, `sender.ts`, `auth.ts` — all use the same launch pattern.

### Hard Constraint

**No headless mode.** LinkedIn fingerprints headless browsers (even `headless: "new"` in Chrome 112+). The user has explicitly ruled this out.

---

### Approach A — Off-Screen Chrome Window

**What:** Launch Chrome at coordinates far outside the visible screen area.

**How:** Change the Puppeteer launch args:

```
args: ["--window-position=-32000,-32000", "--window-size=1280,900"]
```

Remove `--start-maximized`.

**Pros:**
- Simplest change — two lines in each launch call.
- Chrome is fully non-headless. LinkedIn sees a normal browser session.
- Stealth plugin continues to work exactly as before.
- Works across macOS, Windows, Linux.

**Cons:**
- On macOS, Chrome still appears in the Dock and in Mission Control / Cmd-Tab. A user who swipes or Cmd-Tabs may notice it.
- Some window managers may clamp coordinates to the visible area (rare on macOS, more common on Linux tiling WMs).

**Risk Level:** Low. LinkedIn has no way to detect window position.

---

### Approach B — Minimized Chrome Window

**What:** Launch Chrome in a minimized state so it never occupies screen space.

**How:** Change launch args:

```
args: ["--start-minimized"]
```

Alternatively, after launch, use Puppeteer's CDP session to minimize:

```js
const cdp = await page.createCDPSession();
await cdp.send("Browser.setWindowBounds", {
  windowId: /* ... */,
  bounds: { windowState: "minimized" },
});
```

**Pros:**
- Chrome is non-headless with a real window — LinkedIn sees normal behavior.
- Stealth plugin works unchanged.
- No off-screen coordinate hacks.

**Cons:**
- Chrome still shows in the Dock / taskbar. A user may click it and see the automation in progress.
- `--start-minimized` is unreliable on macOS (Chrome may ignore it). The CDP approach is more dependable.
- A minimized window can still briefly flash on launch before minimizing.

**Risk Level:** Low for detection. Medium for UX polish (dock icon, brief flash).

---

### Approach C — Off-Screen + macOS "Hide" via AppleScript

**What:** Combine Approach A (off-screen position) with a macOS `osascript` call to hide Chrome from the Dock switcher.

**How:** After Puppeteer launches Chrome, run:

```bash
osascript -e 'tell application "System Events" to set visible of process "Google Chrome" to false'
```

This hides Chrome from Cmd-Tab and Mission Control without closing or minimizing it.

**Pros:**
- Chrome is fully invisible to the user — no dock bounce, no Cmd-Tab entry, no Mission Control tile.
- Still non-headless. LinkedIn sees a normal browser.
- Stealth plugin works.

**Cons:**
- macOS-only. Would need platform-specific equivalents on Windows/Linux (e.g., `ShowWindow(SW_HIDE)` on Windows via a native addon or PowerShell).
- If the user has Chrome already open for personal use, hiding it may affect their personal Chrome windows too (since it hides the entire Chrome *process*, not a single window). This is the biggest practical concern.
- Relies on Accessibility permissions for System Events.

**Risk Level:** Low for detection. Medium for implementation (platform-specific, shared-process conflict).

---

### Approach D — Separate Chrome User Data Dir + Off-Screen

**What:** Launch Chrome with a dedicated `--user-data-dir` so it runs as a *separate Chrome instance* (separate dock icon, separate process group), then position it off-screen.

**How:**

```
args: [
  "--window-position=-32000,-32000",
  "--window-size=1280,900",
  "--user-data-dir=/path/to/app/chrome-profile"
]
```

This ensures the automation Chrome is completely isolated from the user's personal Chrome. The macOS hide trick (Approach C) can then safely target only this instance.

**Pros:**
- Full process isolation — hiding this Chrome won't affect the user's personal browsing.
- Off-screen position keeps it invisible.
- Non-headless, stealth works, LinkedIn sees a normal session.
- The dedicated profile also eliminates cookie/extension conflicts.

**Cons:**
- A second Chrome icon appears in the Dock (unless hidden via AppleScript).
- Slightly more disk usage for the separate profile directory.
- Cookies are already file-based and injected via `page.setCookie()`, so the separate data dir doesn't conflict — but it also doesn't help with session sharing; the current cookie approach keeps working as-is.

**Risk Level:** Low across the board. This is the most robust option.

---

### Approach E — Electron Hidden BrowserWindow

**What:** Instead of launching external Chrome, create a hidden `BrowserWindow` (`show: false`) inside the Electron app and use its webContents for LinkedIn automation.

**How:** Create a secondary BrowserWindow:

```js
const hiddenWin = new BrowserWindow({ show: false, width: 1280, height: 900 });
hiddenWin.loadURL("https://www.linkedin.com/login");
```

Then drive it with Electron's `webContents` API (executeJavaScript, navigation events, etc.).

**Pros:**
- No external Chrome process. Everything stays inside the Electron app.
- Truly invisible — no Dock icon, no Cmd-Tab entry, no window at all.
- Shares Electron's session (or can use a partition for isolation).

**Cons:**
- **No stealth plugin.** Puppeteer-extra-plugin-stealth patches dozens of browser fingerprint leaks. Electron's Chromium doesn't benefit from these patches. LinkedIn could detect automation signals.
- **Different user agent.** Electron's Chromium identifies as Electron, not as regular Chrome. This is a red flag for LinkedIn.
- Rewriting `scraper.ts` and `sender.ts` from Puppeteer API to Electron `webContents` API is a significant refactor — different DOM access patterns, no `page.evaluate()`, no `page.waitForSelector()` out of the box.
- Electron's Chromium version may lag behind the user's Chrome, creating fingerprint mismatches.

**Risk Level:** High for LinkedIn detection. High for implementation effort.

---

### Recommendation

| Approach | Detection Risk | UX Polish | Effort | Verdict |
|----------|---------------|-----------|--------|---------|
| A — Off-screen | None | Good (dock icon visible) | Very low | Good starting point |
| B — Minimized | None | OK (dock icon, brief flash) | Low | Viable fallback |
| C — Off-screen + AppleScript hide | None | Excellent | Medium | Great on macOS |
| **D — Separate data dir + off-screen** | **None** | **Excellent** | **Low–Medium** | **Best overall** |
| E — Electron BrowserWindow | **High** | Excellent | High | Not recommended |

**Start with Approach D.** It gives full process isolation, keeps Chrome non-headless with stealth, and positions the window off-screen. Add the macOS AppleScript hide as an enhancement to remove the Dock icon entirely. The implementation is small — the only changes are in the `args` array passed to `puppeteer.launch()` in `scraper.ts`, `sender.ts`, and `auth.ts`.

For `auth.ts` (login flow), the browser **should remain visible** since the user needs to manually enter credentials and complete 2FA. Only scrape and send operations should go off-screen.

---

## Part 2 — Replacing Raw Logs with Status UX

### Current State

- **ComposePage (single mode):** Shows a collapsible "Diagnostic Logs" panel with every log entry (timestamp, level, component, message). Useful for devs, noisy for users.
- **ComposePage (bulk mode):** Shows per-URL status (pending/processing/done/error) plus the same diagnostic log panel.
- **DraftsPage / TrackingPage / RepliesPage (send operations):** No log display at all — just a "Sending…" button label and an error message if it fails.

### Goal

Show the user **what is happening in plain language**, with a clean, aesthetic progress indicator. Keep raw logs in backend log files only.

---

### Proposed UX — Status Steps

Replace the log panel with a **step-based progress display**. Each operation (scrape or send) has well-defined steps. Show them as a vertical list of steps with status indicators.

**For scraping a profile:**

| Step | Status text shown to user |
|------|--------------------------|
| 1 | Connecting to LinkedIn… |
| 2 | Loading profile page… |
| 3 | Reading headline and summary… |
| 4 | Reading experience… |
| 5 | Reading education… |
| 6 | Checking recent posts… |
| 7 | Generating outreach message… |
| 8 | Done |

**For sending a message:**

| Step | Status text shown to user |
|------|--------------------------|
| 1 | Connecting to LinkedIn… |
| 2 | Opening profile… |
| 3 | Opening message window… |
| 4 | Composing message… |
| 5 | Sending… |
| 6 | Done |

Each step would show:
- A status icon: spinner (in-progress), checkmark (done), or X (failed).
- The human-readable label.
- Elapsed time for the current step (optional, adds a "things are moving" feel).

### How to Implement This

**Backend:** Introduce a new concept — **status events** — alongside (not replacing) the existing log system.

- Add a `statusForwarder` to the logger (similar to the existing `logForwarder`) or create a separate `status` module.
- At key points in `scraper.ts` and `sender.ts`, emit status events like `{ step: 3, label: "Reading headline and summary…", state: "in-progress" }`.
- The raw `log.info()` / `log.debug()` calls stay exactly as they are, continuing to write to log files.

**IPC:** Create a new channel (e.g., `operation:status`) to stream status events to the renderer, separate from `scrape:log`.

**Frontend:** Build a small `StatusSteps` component:

- Receives status events via the new IPC channel.
- Renders the step list with icons and labels.
- Shows the current step highlighted, previous steps as completed, future steps as pending.
- Replaces the `diag-log-panel` in ComposePage.
- Can also be added to DraftsPage/TrackingPage/RepliesPage for send operations (which currently show no progress at all).

### Where Raw Logs Go

- **Log files on disk** — already happening via `logger.ts` → `logs/scrape-*.log`. No change needed.
- **UI** — remove the diagnostic log panel from ComposePage. Add a small "View Logs" link that opens the logs folder (the `openLogsFolder()` call already exists).
- **stderr** — already happening. No change.

---

## Part 3 — Summary of Changes

### What changes, by file

| File | Change |
|------|--------|
| `src/backend/scraper.ts` | Update launch args (off-screen, separate data dir). Add status event emissions at key scrape steps. |
| `src/backend/sender.ts` | Update launch args (off-screen, separate data dir). Add status event emissions at key send steps. |
| `src/backend/auth.ts` | Only add separate data dir (keep browser visible for manual login). |
| `src/backend/logger.ts` | Add `statusForwarder` (or create a new `status.ts` module) for structured status events. |
| `src/shared/ipc-channels.ts` | Add new `operation:status` channel. |
| `electron/preload.ts` | Expose `onOperationStatus` / `offOperationStatus` to the renderer. |
| `electron/ipc/scrape.ipc.ts` | Wire status forwarder in scrape handlers. |
| `electron/ipc/lead.ipc.ts` | Wire status forwarder in send handlers. |
| `src/renderer/pages/ComposePage.tsx` | Replace `diag-log-panel` with new `StatusSteps` component. Keep "View Logs" link. |
| `src/renderer/pages/DraftsPage.tsx` | Add `StatusSteps` to show send progress (currently shows nothing). |
| New: `src/renderer/components/StatusSteps.tsx` | Reusable step-based progress component. |
| New: `src/renderer/components/StatusSteps.css` | Styles for the progress component. |

### What does NOT change

- LinkedIn detection profile — Chrome stays non-headless with stealth.
- Cookie management — file-based, injected via `page.setCookie()`.
- Login flow — browser stays visible for manual auth.
- Log file infrastructure — `logger.ts` continues writing to `logs/`.
- Database, LLM integration, lead pipeline — untouched.

---

## Open Questions

1. **Windows/Linux support** — If the app needs to run on Windows or Linux, the AppleScript hide trick won't work. Off-screen positioning alone is sufficient for those platforms (no Cmd-Tab equivalent shows off-screen windows as prominently). Is macOS the only target?

2. **Parallel operations** — The user has said no parallel activities. Currently each operation launches a fresh Chrome instance and closes it when done. Should we keep this pattern, or reuse a persistent background Chrome instance across operations? Reuse would be faster (no cold start) but adds session-management complexity.

3. **Send operation logs** — Today, `sender.ts` logs are not forwarded to the UI at all. Should the new status steps be the *only* feedback during send, or should we also start writing sender logs to files (they currently only go to stderr)?

4. **Error detail** — When a step fails, should the UI show the raw error message, or a simplified version? A "View Details" expansion that shows the specific error could balance clarity with debuggability.
