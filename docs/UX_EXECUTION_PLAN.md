# VisionBridge: UX Transformation — Phased Execution Plan

## How to Use This Document

This document breaks the full UX transformation (described in `DESKTOP_UX_TRANSFORMATION.md`) into **14 sequential phases**. Each phase is scoped so that a single LLM session can complete it confidently. Phases are ordered by dependency — each builds on the previous — but the application **may be in a broken/incomplete state between phases**. That is expected and acceptable.

When executing a phase, the model should:
1. Read this document for scope and goals of the current phase
2. Read `DESKTOP_UX_TRANSFORMATION.md` for the detailed design specifications
3. Work only within the scope of the current phase
4. Not worry about things that will be addressed in later phases

---

## Current Application State (Baseline)

Before any phase begins, here is the state of the application:

- **Framework:** Electron + React 18 + React Router DOM v7 (HashRouter)
- **Styling:** Single plain CSS file (`src/renderer/App.css`, ~3135 lines), no CSS modules/Tailwind/styled-components
- **Layout:** Horizontal sticky header with nav links, centered content column (`max-width: 760px`), full-page scrolling
- **Navigation:** Horizontal top nav bar with text links: Compose, Drafts, Tracking, Replies, Closed
- **Data display:** Vertically stacked cards on all pages
- **Icons:** Unicode characters (✓, ✗, ↻, ▾, etc.)
- **State management:** Local React state only (useState, useCallback, useRef)
- **Window:** Default OS frame (`frame: true` implicit), no custom title bar
- **Theming:** Hardcoded colors, light theme only, no CSS custom properties (except limited use in Prompt Preview)
- **IPC:** `contextBridge` + `ipcRenderer.invoke` / `on` / `off` via `window.api`
- **Keyboard shortcuts:** Only `Cmd+Shift+L` for login
- **Context menus:** None
- **Status bar:** None
- **Sidebar:** None
- **Animation:** CSS transitions only (no Framer Motion, GSAP, etc.)
- **Notifications:** Custom CSS toast (`.tracking-toast`), native OS notifications for queue drain

### Key Files

| File | Description |
|------|-------------|
| `electron/main.ts` | Electron main process, window creation |
| `electron/preload.ts` | IPC bridge, exposes `window.api` |
| `electron/menu.ts` | Application menu with keyboard shortcuts |
| `electron/queue.ts` | Job queue system (dataQueue + actionQueue) |
| `electron/window-state.ts` | Window position/size persistence |
| `electron/ipc/scrape.ipc.ts` | Scrape-related IPC handlers |
| `electron/ipc/login.ipc.ts` | LinkedIn login IPC |
| `electron/ipc/lead.ipc.ts` | Lead CRUD IPC |
| `electron/ipc/queue.ipc.ts` | Queue status/progress IPC |
| `electron/ipc/sender-config.ipc.ts` | Sender configuration IPC |
| `src/shared/ipc-channels.ts` | IPC channel name constants |
| `src/renderer/main.tsx` | React entry point |
| `src/renderer/App.tsx` | Root component: header, nav, routes, QueueIndicator |
| `src/renderer/App.css` | All application styles (~3135 lines) |
| `src/renderer/env.d.ts` | TypeScript types for `window.api` and IPC payloads |
| `src/renderer/index.html` | HTML shell |
| `src/renderer/pages/ComposePage.tsx` | Compose: sender config, URL input, single/bulk scrape |
| `src/renderer/pages/DraftsPage.tsx` | Drafts: lead cards, bulk select, send/delete |
| `src/renderer/pages/TrackingPage.tsx` | Tracking: contacted leads, follow-ups, filters |
| `src/renderer/pages/RepliesPage.tsx` | Replies: conversation threads, reply composer |
| `src/renderer/pages/ClosedPage.tsx` | Closed: converted/cold leads, reopen |

---

## Phase 1: Foundation — Design System & Viewport Setup

### Goal
Establish the CSS design system (custom properties) and viewport model that all subsequent phases build on. This phase is purely foundational — no layout changes, no new components. The app should look almost identical after this phase, just with the color/spacing values coming from CSS variables instead of hardcoded values.

### Scope

1. **Install `lucide-react`** — Add the icon library dependency. No icons need to be replaced yet (that happens in Phase 3), but the dependency should be available.

2. **Define CSS custom properties in `:root`** — Create the full set of theming variables as specified in Section 17 of the transformation doc. This includes colors for backgrounds, text, borders, accents, sidebar, status bar, etc. The goal is to have every color the app needs defined as a variable.

3. **Replace hardcoded color values in `App.css` with CSS variables** — Go through the entire CSS file and replace hardcoded hex values (`#f5f5f5`, `#0077b5`, `#1a1a1a`, `#e1e4e8`, etc.) with the corresponding `var(--...)` references. This is a large but mechanical change. Every color in the file should reference a CSS variable by the end.

4. **Set up the viewport model** — In `index.html` and/or `App.css`:
   - Set `html, body { margin: 0; padding: 0; overflow: hidden; height: 100vh; }` 
   - Set the root app container to `height: 100vh; overflow: hidden; display: flex; flex-direction: column;`
   - This prevents page-level scrolling. Content panels won't scroll yet (that's Phase 2), so some content may become inaccessible temporarily — that's OK.

5. **Remove the `@media (max-width: 700px)` responsive breakpoint** — Desktop apps don't need mobile breakpoints. Remove any responsive rules.

### Files to Modify
- `package.json` — add `lucide-react`
- `src/renderer/App.css` — CSS variables, color replacements, viewport model, remove media queries
- `src/renderer/index.html` — body overflow styles if needed

### What NOT to Do
- Don't change any component structure or layout
- Don't replace icons yet
- Don't change font sizes or spacing yet
- Don't create new components

---

## Phase 2: App Layout Shell — Sidebar, Status Bar & Scroll Architecture

### Goal
Transform the application from a "web page with a sticky header" into a "desktop app with a sidebar, content area, and status bar." This is the single highest-impact phase. After this phase, the app should feel fundamentally different — a fixed frame with a dark sidebar on the left, content filling the remaining space, and a status bar at the bottom.

### Scope

1. **Create `Sidebar.tsx`** — A vertical navigation sidebar component as specified in Section 3 of the transformation doc:
   - Dark background (using the CSS variables from Phase 1)
   - Navigation items: Compose, Drafts, Tracking, Replies, Closed, Pipeline (Pipeline page doesn't exist yet — just the nav link pointing to a placeholder route)
   - Each item has a Lucide icon and label
   - Count badges for Drafts, Tracking, Replies, Closed (use existing data — the current nav already has an overdue badge on Tracking)
   - Active state: left border accent + background highlight
   - Bottom section: Settings link, Open Logs link
   - Collapse/expand toggle (200px expanded, 48px icon-only collapsed)
   - Smooth collapse/expand animation

2. **Create `StatusBar.tsx`** — A persistent bottom bar as specified in Section 14:
   - Left: LinkedIn session status (Connected/Expired/Unknown with color indicator)
   - Center: Pipeline status summary (replaces the QueueIndicator from the header) — subscribe to the same queue IPC events
   - Right: Total lead count or per-stage counts
   - Fixed height (~24-28px), small font
   - The pipeline status section should eventually be clickable to navigate to Pipeline page

3. **Restructure `App.tsx` layout** — Replace the header-based layout with the desktop layout:
   - Remove the `<header className="app-header">` and all its contents (logo, horizontal nav, QueueIndicator)
   - New layout structure: Sidebar (left) + Main area (right column containing content + status bar)
   - The main content area should have `flex: 1; overflow-y: auto;` so it scrolls independently
   - Add a route for `/pipeline` pointing to a placeholder component (just a "Pipeline — coming soon" message is fine)
   - Add a route for `/settings` pointing to a placeholder component
   - Move the session-expired banner logic — instead of a full-width banner, show it as a subtle indicator in the status bar or as a small banner within the content area

4. **Update `App.css`** — Add styles for the new layout shell:
   - Sidebar styles (dark theme, nav items, hover states, active states, badges, collapse animation)
   - Status bar styles
   - Main content area with independent scrolling
   - Remove old header/nav styles (`.app-header`, `.app-header-inner`, `.app-nav`, `.nav-link`, etc.)
   - Each page's content container should get `overflow-y: auto` so it scrolls within the content area

5. **Remove `max-width: 760px` constraints** — All page containers (`.container`, `.drafts-container`, etc.) should fill the available width instead of being constrained to a narrow column.

### Files to Modify
- `src/renderer/components/Sidebar.tsx` — **new file**
- `src/renderer/components/StatusBar.tsx` — **new file**
- `src/renderer/App.tsx` — layout restructure
- `src/renderer/App.css` — new layout styles, remove old header/nav styles, remove max-width constraints

### What NOT to Do
- Don't redesign individual pages yet (they'll still show cards, just full-width now)
- Don't build the bottom panel yet
- Don't implement keyboard shortcuts for navigation yet
- Don't implement the command palette

---

## Phase 3: Typography, Visual Density & Icon Replacement

### Goal
Make the application visually denser and more desktop-appropriate. Replace all Unicode character icons with proper Lucide icons. Adjust typography and spacing to match desktop conventions. After this phase, the app should look noticeably more professional and dense.

### Scope

1. **Replace all Unicode icons with Lucide React icons** across every page component and App.tsx:
   - `✓` → `Check` icon
   - `✗` / `✕` → `X` icon
   - `↻` → `RefreshCw` icon
   - `▾` / `▸` → `ChevronDown` / `ChevronRight` icon
   - `✦` → appropriate icon per context (e.g., `Sparkles`, `Send`, `FileText`)
   - `⊘` → `Ban` or `CircleOff` icon
   - Any other Unicode characters used as icons
   - Review each page (ComposePage, DraftsPage, TrackingPage, RepliesPage, ClosedPage) and App.tsx for all icon usage
   - Icon sizes: 16px for inline/buttons, 20px for navigation (sidebar already done), 14px for small table actions

2. **Adjust typography** as specified in Section 13:
   - Page headings: reduce from 28px to 16-18px, semibold
   - Body text: 13px instead of 14-15px
   - Labels/metadata: 11-12px
   - Monospace (logs): 12px
   - Line height: 1.3-1.4 for general text, 1.5 for textareas
   - Keep the system font stack

3. **Increase visual density** as specified in Section 13:
   - Reduce container padding from 32px/16px/64px to 12-16px
   - Reduce card padding from 16-24px to 8-12px
   - Reduce button padding from 10px 18px to 6px 12px
   - Reduce gaps between items from 10-16px to 4-8px
   - Reduce form field padding to 6px 10px
   - Overall ~40% reduction in whitespace

4. **Update button and form styling** — Make buttons more compact, form fields tighter, consistent with desktop density. Remove overly rounded corners (e.g., `border-radius: 12px` → `4-6px`).

### Files to Modify
- `src/renderer/App.css` — typography, spacing, density changes throughout
- `src/renderer/App.tsx` — replace any icons in the root layout
- `src/renderer/pages/ComposePage.tsx` — replace Unicode icons
- `src/renderer/pages/DraftsPage.tsx` — replace Unicode icons
- `src/renderer/pages/TrackingPage.tsx` — replace Unicode icons
- `src/renderer/pages/RepliesPage.tsx` — replace Unicode icons
- `src/renderer/pages/ClosedPage.tsx` — replace Unicode icons

### What NOT to Do
- Don't change page layouts or component structure
- Don't create new components
- Don't add new features

---

## Phase 4: Compose Page Redesign & Settings Page

### Goal
Redesign the Compose page to be a clean, focused workspace. Move sender configuration out of Compose and into a dedicated Settings page. The Compose page should feel like a purpose-built tool, not a web form.

### Scope

1. **Create `SettingsPage.tsx`** — A new page at route `/settings` containing:
   - The sender configuration form (currently embedded in ComposePage) — sender name, LinkedIn profile URL, persona/tone settings, and any other config fields
   - The prompt/template preview (currently in ComposePage's Prompt Preview section)
   - Possibly organized into sections/tabs: "Sender Profile", "Prompt Template", "Preferences"
   - This page uses the settings route that was set up as a placeholder in Phase 2

2. **Redesign `ComposePage.tsx`** — Strip it down to a focused compose workspace:
   - Remove the sender config form (it's now in Settings)
   - Prominent URL input bar at the top — clean, minimal, centered feel (like Spotlight/Alfred)
   - Compact Single/Bulk mode toggle below the input
   - For Single mode: the scrape result should appear alongside the input area (not stacked far below)
   - For Bulk mode: URL list and progress side by side
   - Keep the existing log panel for now (it will be replaced by the Activity Feed in Phase 5) — but you can clean up its presentation
   - Remove the `.container` max-width constraint if not already done

3. **Update routing in `App.tsx`** — Replace the Settings placeholder route with the real SettingsPage component.

4. **Update sidebar** — Make sure the Settings link in the sidebar navigates to `/settings`.

5. **Move relevant IPC and state** — The sender config loading/saving logic currently in ComposePage needs to move to SettingsPage. Make sure the sender config data is still accessible where needed (e.g., when scraping, the sender config is read from the backend via IPC, so the compose page doesn't need to hold it in state anymore).

### Files to Modify
- `src/renderer/pages/SettingsPage.tsx` — **new file**
- `src/renderer/pages/ComposePage.tsx` — major redesign
- `src/renderer/App.tsx` — update route
- `src/renderer/App.css` — styles for Settings page and redesigned Compose page

### What NOT to Do
- Don't build the Activity Feed yet (Phase 5)
- Don't add keyboard shortcuts

---

## Phase 5: Activity Feed System

### Goal
Replace the raw log dump on the Compose page with a clean, step-by-step activity feed that shows users what the system is doing in human-readable terms. This requires both backend IPC changes and a new frontend component. See Section 6 of the transformation doc for the full design specification.

### Scope

1. **Define the `ActivityStep` interface** — In `src/renderer/env.d.ts` (or a shared types location):
   - `stepId`, `label`, `status` (pending/active/completed/failed/skipped), `detail?`, `error?`, `startedAt?`, `completedAt?`
   - Also define the step definitions for scrape operations and send operations as listed in Section 6

2. **Add the `SCRAPE_ACTIVITY` IPC channel** — In `src/shared/ipc-channels.ts`, add a new channel constant for activity step events.

3. **Backend: Emit activity step events** — In `electron/ipc/scrape.ipc.ts`:
   - At key points during the scrape process, emit structured `ActivityStep` events via the new IPC channel
   - Map the existing scrape flow to the step definitions (Loading profile → Extracting about → Extracting experience & education → Reading recommendations → Analyzing posts → Scraping messages → Generating draft → Saving lead)
   - The existing `scrape:log` channel continues to work unchanged
   - For send operations (send-initial, send-followup, send-reply in other IPC handlers), emit similar step events

4. **Preload bridge** — In `electron/preload.ts`, expose `onActivityStep` and `offActivityStep` methods on `window.api` (or appropriate namespace).

5. **Create `ActivityFeed.tsx`** — A reusable component that:
   - Accepts a list of activity steps and renders them as a vertical step list
   - Shows status icons: ○ pending, ● active (with pulse animation), ✓ completed (green), ✗ failed (red), ⊘ skipped (gray)  — using Lucide icons
   - Shows elapsed time for completed/active steps
   - Shows a "View Full Logs" link at the bottom
   - For bulk mode: shows per-URL progress with the current step visible for the active URL
   - This component will also be reused in the Pipeline page (Phase 9)

6. **Integrate into ComposePage** — Replace the existing log panel/diagnostic output with the ActivityFeed component. The compose page subscribes to `onActivityStep` events and passes them to the ActivityFeed. The raw log panel is removed from the compose page (it will eventually live in the Bottom Panel, Phase 10).

### Files to Modify
- `src/renderer/env.d.ts` — ActivityStep interface
- `src/shared/ipc-channels.ts` — new channel constant
- `electron/ipc/scrape.ipc.ts` — emit activity steps
- `electron/preload.ts` — expose new IPC methods
- `src/renderer/components/ActivityFeed.tsx` — **new file**
- `src/renderer/pages/ComposePage.tsx` — integrate ActivityFeed, remove raw log panel
- `src/renderer/App.css` — ActivityFeed styles

### What NOT to Do
- Don't build the Pipeline page yet (Phase 9)
- Don't build the Bottom Panel yet (Phase 10)
- Don't modify other IPC handlers beyond scrape (send activity steps for send operations can come later if needed)

---

## Phase 6: Drafts Page — Master-Detail Split View

### Goal
Transform the Drafts page from a vertically-stacked card layout to a master-detail split view with a compact list on the left and a detail panel on the right. This phase also creates reusable components (SplitPane, Toolbar) that later phases will reuse.

### Scope

1. **Create `SplitPane.tsx`** — A reusable horizontal split pane component:
   - Takes left and right children
   - Has a draggable divider between them
   - Remembers proportions (or has configurable default widths)
   - Both panes scroll independently
   - This will be reused on Tracking, Replies, Closed pages in later phases

2. **Create `Toolbar.tsx`** — A reusable toolbar component:
   - A horizontal bar that sits at the top of the content area
   - Accepts children (buttons, search inputs, dropdowns, etc.)
   - Consistent height and styling
   - Supports a "bulk action mode" where different actions appear when items are selected

3. **Redesign `DraftsPage.tsx`** with master-detail split as specified in Section 5.2:
   - **Left pane (list):** Compact rows showing name, role/title, persona tag, and status. No editor or full draft visible. Clicking selects the row. Multi-select via checkboxes.
   - **Right pane (detail):** Shows the full detail of the selected lead — profile info, conversation preview, draft editor textarea with toolbar (Regenerate, Restore, word count), action buttons (Send, Save, Delete)
   - **Toolbar above the list:** Select All checkbox, Refresh All button, Search/Filter input, Sort dropdown
   - **Bulk actions in toolbar:** When items are selected, show "Send (N)", "Delete (N)", "Regenerate (N)", "Deselect All" — replaces the current floating bottom bar pattern
   - Selected row should have a visual indicator (blue left border + light background)
   - Rows should support hover highlighting

4. **Update `App.css`** — Styles for SplitPane, Toolbar, and the redesigned Drafts page. Remove old drafts card styles that are no longer used.

### Files to Modify
- `src/renderer/components/SplitPane.tsx` — **new file**
- `src/renderer/components/Toolbar.tsx` — **new file**
- `src/renderer/pages/DraftsPage.tsx` — major redesign
- `src/renderer/App.css` — SplitPane, Toolbar, and Drafts styles

### What NOT to Do
- Don't redesign other pages yet
- Don't add keyboard navigation yet (Phase 12)
- Don't add context menus yet (Phase 13)

---

## Phase 7: Tracking & Closed Pages — Table Views

### Goal
Convert the Tracking and Closed pages from card layouts to dense, sortable table views with filter toolbars. These two pages are grouped because they share similar table-based display patterns.

### Scope

1. **Redesign `TrackingPage.tsx`** as specified in Section 5.3:
   - **Table view as default** with columns: Name, Role, Persona, Initial Sent, Follow-ups, Next Due, Last Sent, Status
   - Sortable column headers (click to sort)
   - Row coloring for overdue items (subtle red/orange background)
   - Inline actions on hover or via row selection
   - **Filter toolbar** using the Toolbar component from Phase 6 — segmented buttons for status filter, sort control
   - **Follow-up composer:** Should open as a right panel (using SplitPane) or a slide-out drawer instead of the current modal overlay (`.fu-modal-backdrop`). The user should see the lead's info while composing.
   - Remove the old card layout, modal, and dropdown filter styles

2. **Redesign `ClosedPage.tsx`** as specified in Section 5.5:
   - **Table view** with columns: Name, Role, Outcome (Converted/Cold), Initial Contact, Closed Date, Duration, Follow-ups
   - Row styling: green tint for Converted, gray for Cold
   - Sortable headers
   - **Filter as segmented buttons** in the Toolbar (replaces the current `.closed-toggle-bar`)
   - **Summary statistics** at the top: total closed, conversion rate, average time-to-close — displayed as compact metric cards in the toolbar area
   - Reopen action as a button on selected rows
   - Remove old card layout styles

3. **Shared table styling** — Both pages use similar table patterns. Create consistent table CSS classes that can be shared:
   - Fixed header row
   - Alternating row backgrounds
   - Compact row height (36-40px)
   - Hover highlighting
   - Selected row indicator
   - Truncation with ellipsis

### Files to Modify
- `src/renderer/pages/TrackingPage.tsx` — major redesign
- `src/renderer/pages/ClosedPage.tsx` — major redesign
- `src/renderer/App.css` — table styles, filter toolbar styles, remove old card/modal styles

### What NOT to Do
- Don't add context menus yet (Phase 13)
- Don't add keyboard navigation yet (Phase 12)

---

## Phase 8: Replies Page — Three-Pane Layout

### Goal
Transform the Replies page into an email-client-style three-pane layout optimized for conversation management. This is the most complex page redesign. See Section 5.4 of the transformation doc.

### Scope

1. **Redesign `RepliesPage.tsx`** with a three-pane layout:
   - **Left pane:** Lead list with unread indicator, name, last reply snippet, timestamp. Uses SplitPane from Phase 6.
   - **Center pane:** Conversation thread for the selected lead. Messages styled as chat bubbles (sent vs received distinguished visually). Full-height scrollable, independent scroll context. Auto-scroll to newest message.
   - **Right pane (optional):** Lead profile details — name, role, tags, timeline of interactions. This pane can be toggleable or collapsible. If implementing three panes feels too complex, start with two panes (list + conversation) and include profile info at the top of the conversation pane.
   - **Reply composer** at the bottom of the center pane — always visible when a lead is selected, like a chat input bar. Should include the existing AI reply generation functionality.
   - **Actions toolbar** above the conversation: Mark Converted, Mark Cold, Refresh/Update
   - Remove the old card-based layout with inline conversation threads

2. **Chat-style message rendering** — Messages in the conversation should look like chat bubbles:
   - Outgoing messages (sent by user): right-aligned, primary color background
   - Incoming messages (replies from lead): left-aligned, neutral background
   - Timestamps below each message
   - Clear visual distinction between messages

### Files to Modify
- `src/renderer/pages/RepliesPage.tsx` — major redesign
- `src/renderer/App.css` — three-pane layout styles, chat bubble styles, reply composer styles

### What NOT to Do
- Don't add keyboard navigation yet (Phase 12)
- Don't add context menus yet (Phase 13)

---

## Phase 9: Pipeline Dashboard

### Goal
Build a new Pipeline page that provides full visibility into the job queue system. This replaces the tiny "5 tasks queued" header badge with a comprehensive job management interface. See Section 7 of the transformation doc for the full design.

### Scope

1. **Backend changes to `electron/queue.ts`**:
   - Add `startedAt` field to `QueueItemStatus` — timestamp when job transitions from `queued` to `active`
   - Retain recent completed/failed/cancelled jobs in memory (e.g., last 50) instead of cleaning them up immediately on drain
   - Include lead name in the job payload when enqueuing (if available), so the Pipeline page can display human-readable target names
   - Forward activity step events with `jobId` so the Pipeline page can show per-job step progress

2. **Update IPC layer**:
   - `electron/ipc/queue.ipc.ts` — Add a handler to retrieve the full job list (active + queued + recent history), not just the count. Add handler for cancelling individual jobs and retrying failed jobs.
   - `electron/preload.ts` — Expose new methods: `queue.getJobList()`, `queue.cancelJob(id)`, `queue.retryJob(id)`
   - `src/shared/ipc-channels.ts` — Add new channel constants
   - `src/renderer/env.d.ts` — Update `QueueItemStatus` interface with `startedAt`, update window.api types

3. **Create `PipelinePage.tsx`** as specified in Section 7:
   - **Summary cards** at the top: Active (blue), Queued (gray), Completed (green), Failed (red), Cancelled (muted) — with counts, updating in real time
   - **Filter & control bar**: Status filter, Type filter, Queue filter, Clear Completed button, Cancel All button
   - **Job table**: Each row shows status icon, job type (with icon), target lead name/URL, queue (Data/Action), status label, elapsed/wait time, actions (Cancel/Retry)
   - **Row behavior**: Active rows have blue background + pulse, failed rows have red background and are expandable to show error, completed rows are slightly faded
   - **Job detail expansion**: Clicking a row expands to show full job detail including the ActivityFeed step list (reuse the ActivityFeed component from Phase 5), job metadata, and "View Raw Logs" link
   - Real-time updates via queue IPC events

4. **Update StatusBar** — Make the pipeline status section clickable to navigate to the Pipeline page. Show alert indicator when jobs have failed.

5. **Update routing in `App.tsx`** — Replace the Pipeline placeholder with the real PipelinePage.

### Files to Modify
- `electron/queue.ts` — startedAt field, job history retention, lead name in payload
- `electron/ipc/queue.ipc.ts` — job list retrieval, cancel, retry handlers
- `electron/preload.ts` — expose new queue methods
- `src/shared/ipc-channels.ts` — new channel constants
- `src/renderer/env.d.ts` — updated interfaces
- `src/renderer/pages/PipelinePage.tsx` — **new file**
- `src/renderer/App.tsx` — update route
- `src/renderer/components/StatusBar.tsx` — clickable pipeline status
- `src/renderer/App.css` — Pipeline page styles

### What NOT to Do
- Don't change other pages
- Don't build the Bottom Panel's Queue tab yet (Phase 10)

---

## Phase 10: Bottom Panel / Drawer System

### Goal
Create a collapsible bottom panel (like VS Code's terminal panel) with tabs for Logs, Queue, and Output. This is where the raw developer-facing log stream moves to. See Section 9 of the transformation doc.

### Scope

1. **Create `BottomPanel.tsx`** — A collapsible, resizable panel at the bottom of the content area:
   - **Tabs**: Logs, Queue, Output
   - **Logs tab**: Full raw log stream from the backend (`scrape:log` events) in monospace format. Supports filtering by log level (INFO/DEBUG/ERROR) and by component name. Auto-scrolls to newest. This is where the detailed developer-facing logs now live.
   - **Queue tab**: A compact live view of active and queued jobs — a lightweight version of the Pipeline page. Shows currently processing job with its activity steps, plus the queue of upcoming jobs. Allows cancelling jobs inline.
   - **Output tab**: Results from bulk operations, export summaries, etc. Can start as a simple text output area.
   - Panel is toggleable (open/closed)
   - Panel has a drag handle on its top edge for resizing
   - Panel remembers its last height (store in state or localStorage)
   - Panel can collapse to just its tab bar (clicking an active tab collapses it)
   - The Logs tab should subscribe to the existing `scrape:log` IPC events

2. **Integrate into the app layout** — The bottom panel sits between the main content area and the status bar. Update the layout in `App.tsx` to accommodate it.

3. **Update ComposePage** — Add a "View Full Logs" link in the ActivityFeed (from Phase 5) that opens the bottom panel's Logs tab. If there was any remaining raw log display on the compose page, remove it — all raw logs go to the bottom panel now.

### Files to Modify
- `src/renderer/components/BottomPanel.tsx` — **new file**
- `src/renderer/App.tsx` — integrate bottom panel into layout
- `src/renderer/pages/ComposePage.tsx` — "View Full Logs" integration
- `src/renderer/App.css` — bottom panel styles, tabs, log viewer styles

### What NOT to Do
- Don't add keyboard shortcut for toggle yet (Phase 12)

---

## Phase 11: Custom Title Bar & Window Chrome

### Goal
Replace the default OS title bar with a custom integrated title bar that includes app branding and a search trigger. This removes the redundant OS chrome and saves vertical space. See Section 4 of the transformation doc.

### Scope

1. **Update `electron/main.ts`** — Change BrowserWindow options:
   - macOS: `titleBarStyle: 'hiddenInset'` — hides the title bar but keeps traffic light buttons
   - Windows: `titleBarOverlay: { color: '<sidebar-color>', symbolColor: '<text-color>', height: 36 }` — keeps native window controls as an overlay
   - Set appropriate min dimensions for the window (e.g., `minWidth: 1000, minHeight: 600`)

2. **Create a custom title bar element** — In `App.tsx` (or a new `TitleBar.tsx` component):
   - A `<div>` at the top of the app with `-webkit-app-region: drag` for the draggable area
   - Height: 32-38px
   - Contains: App name/logo text on the left
   - Contains: A search trigger button ("Search leads... ⌘K") in the center — this doesn't need to work yet (Command Palette comes in Phase 12), but the visual placeholder should be there
   - On macOS: leave ~70px padding on the left for traffic light buttons
   - On Windows: the native window controls are handled by `titleBarOverlay`
   - Non-draggable interactive elements (search button) should have `-webkit-app-region: no-drag`

3. **Adjust sidebar positioning** — The sidebar should start below the title bar (or integrate with it visually). Make sure the sidebar's top aligns correctly with the new title bar.

4. **Platform detection** — Use `process.platform` (available via IPC or preload) or a CSS approach to handle platform-specific padding/layout.

### Files to Modify
- `electron/main.ts` — title bar options, min window dimensions
- `src/renderer/App.tsx` — add title bar element, adjust layout
- `src/renderer/App.css` — title bar styles, platform-specific adjustments
- Optionally `src/renderer/components/TitleBar.tsx` — **new file** (if extracted as a component)

### What NOT to Do
- Don't implement the command palette functionality yet (Phase 12)
- Don't add search functionality yet

---

## Phase 12: Keyboard Shortcuts & Command Palette

### Goal
Make the application keyboard-first. Add comprehensive keyboard shortcuts and a VS Code / Spotlight-style command palette for searching leads and running commands. See Sections 10 and 3 of the transformation doc.

### Scope

1. **Register global keyboard shortcuts in the renderer** — In `App.tsx` or a dedicated `useKeyboardShortcuts` hook:
   - `Cmd/Ctrl+1` through `6` — switch between Compose, Drafts, Tracking, Replies, Closed, Pipeline
   - `Cmd/Ctrl+K` — open command palette
   - `Cmd/Ctrl+,` — open Settings
   - `Cmd/Ctrl+J` — toggle bottom panel
   - `Cmd/Ctrl+B` — toggle sidebar collapse/expand
   - `Cmd/Ctrl+N` — focus URL input on Compose
   - `Cmd/Ctrl+R` — refresh current view
   - `Escape` — close detail panel / command palette / deselect

2. **Page-specific keyboard navigation** — In each list/table page:
   - `↑ / ↓` — navigate list/table items
   - `Enter` — open selected item in detail panel / confirm action
   - `Delete / Backspace` — delete selected item (with confirmation)
   - `Cmd/Ctrl+S` — save current draft
   - `Cmd/Ctrl+Enter` — send current draft/reply
   - `Cmd/Ctrl+A` — select all items in list
   - `Space` — toggle checkbox on focused item
   - `Tab` — move focus between panes

3. **Update `electron/menu.ts`** — Add keyboard accelerators for navigation shortcuts so they also work as native menu items. This ensures shortcuts work even when the renderer doesn't have focus.

4. **Create `CommandPalette.tsx`** — A modal overlay command palette:
   - Triggered by `Cmd/Ctrl+K`
   - Text input at the top with auto-focus
   - Search results below, filtered as user types
   - Search across: lead names (all stages), page names, commands
   - Commands include: "Go to Compose", "Go to Drafts", "Open Settings", "Toggle Sidebar", etc.
   - Navigate results with arrow keys, select with Enter, dismiss with Escape
   - Keyboard-only — no mouse required to use it

5. **Integrate search into title bar** — The search placeholder from Phase 11 should now trigger the command palette when clicked.

### Files to Modify
- `src/renderer/components/CommandPalette.tsx` — **new file**
- `src/renderer/App.tsx` — keyboard event listeners, command palette integration
- `src/renderer/pages/DraftsPage.tsx` — list keyboard navigation
- `src/renderer/pages/TrackingPage.tsx` — table keyboard navigation
- `src/renderer/pages/RepliesPage.tsx` — list keyboard navigation
- `src/renderer/pages/ClosedPage.tsx` — table keyboard navigation
- `electron/menu.ts` — add accelerators
- `src/renderer/App.css` — command palette styles

### What NOT to Do
- Don't add drag & drop yet

---

## Phase 13: Context Menus & Native Interactions

### Goal
Add right-click context menus to all lead lists and tables, and replace web-style confirmation modals with native OS dialogs for destructive actions. See Sections 11 and 15 of the transformation doc.

### Scope

1. **Right-click context menus on every lead list/table** — Each page should have contextual menus when right-clicking a lead row:
   - **Drafts**: Edit Draft, Regenerate Draft, Send, Save Draft, Refresh Profile, Refresh Draft, Refresh Both, Copy Draft Text, Open LinkedIn Profile, Delete
   - **Tracking**: Follow Up, Mark Cold, Refresh Profile, Open LinkedIn Profile, Copy Profile URL
   - **Replies**: Reply, Mark Converted, Mark Cold, Open LinkedIn Profile, Copy Profile URL
   - **Closed**: Reopen to Drafts, Open LinkedIn Profile, Copy Profile URL
   - **Pipeline**: Cancel Job, Retry Job, View Logs

2. **Implementation approach** — Choose one:
   - **Option A (Recommended for desktop feel):** Use Electron's native `Menu.buildFromTemplate()` via IPC. The renderer sends a request to the main process with the menu template, the main process shows the native context menu, and sends back the selected action. This gives true OS-native context menus.
   - **Option B:** Use a React context menu library for custom-styled menus. Faster to implement but less native.
   - The decision can be made by the implementing model, but Option A is preferred.

3. **Double-click behavior** — Double-clicking a lead row should open it in the detail panel (or focus the editor on Drafts).

4. **Native OS dialogs for destructive actions** — Replace custom modal confirmations with `dialog.showMessageBox()` via IPC for:
   - Deleting leads (single and bulk)
   - Cancelling all queued jobs
   - Any other destructive action that currently uses a custom overlay modal
   - Non-destructive confirmations (like "confirm send") can remain as inline UI

5. **Add IPC for native dialogs** — In `electron/preload.ts`, expose a `showConfirmDialog(title, message)` method that invokes `dialog.showMessageBox()` in the main process and returns the user's choice.

### Files to Modify
- `electron/preload.ts` — expose context menu and dialog methods
- `electron/main.ts` or `electron/ipc/` — handlers for context menu and dialog IPC
- `src/renderer/env.d.ts` — types for new IPC methods
- `src/renderer/pages/DraftsPage.tsx` — context menu, double-click, native dialogs
- `src/renderer/pages/TrackingPage.tsx` — context menu, double-click
- `src/renderer/pages/RepliesPage.tsx` — context menu, double-click
- `src/renderer/pages/ClosedPage.tsx` — context menu, double-click
- `src/renderer/pages/PipelinePage.tsx` — context menu
- `src/renderer/App.css` — styles if using React-based context menus

### What NOT to Do
- Don't implement drag & drop yet

---

## Phase 14: Polish & Advanced Features

### Goal
Final polish pass. Add drag & drop, page transitions, dark theme groundwork, notification center, and any remaining refinements. This phase addresses everything in Phase 5 of the original transformation doc's priority list, plus any loose ends.

### Scope

1. **Drag & drop** (Section 16):
   - Drag leads between stages via the sidebar (e.g., drag a draft onto "Closed" to mark as cold)
   - Reorder leads within a list (priority ordering)
   - Use HTML5 drag and drop API or a library like `@dnd-kit`
   - This is an enhancement — if implementation proves too complex, it can be simplified or deferred

2. **Page transitions** — Add subtle slide/fade animations when switching between pages via React Router. Keep them fast (150-200ms) and purposeful. Consider using CSS transitions on route change or a lightweight animation approach.

3. **Dark theme support** (Section 17):
   - Since Phase 1 established CSS custom properties, adding a dark theme means creating an alternative set of variable values
   - Add a `[data-theme="dark"]` selector block with dark-mode color values
   - Add a theme toggle in Settings (and optionally respect `prefers-color-scheme` media query)
   - Persist the theme preference

4. **Notification center** (Section 15):
   - Replace scattered toast messages with a unified notification system
   - A small notification icon in the status bar showing a count of recent events
   - Clicking it opens a dropdown/panel with notification history
   - Notifications for: job completed, job failed, session expired, send confirmed, etc.
   - Native OS notifications continue to work for background events

5. **General polish**:
   - Review all pages for visual consistency
   - Ensure all animations are smooth and performant
   - Fix any broken layouts or styling issues accumulated across phases
   - Ensure the sidebar badges (counts) update correctly on all pages
   - Test that the status bar shows accurate information
   - Verify that split pane dividers work correctly
   - Make sure all Lucide icons are consistent in size and style

6. **Move banners to status bar** — If the session-expired banner is still a full-width banner, move it to a status bar indicator (orange/red) as specified in Section 15.

### Files to Modify
- Multiple files across the application — this phase touches many files but with small changes each
- `src/renderer/App.css` — dark theme variables, page transition styles
- `src/renderer/App.tsx` — theme toggle logic, page transitions
- `src/renderer/components/StatusBar.tsx` — notification center
- `src/renderer/pages/SettingsPage.tsx` — theme toggle
- Various page components — drag & drop integration, polish fixes

---

## Phase Dependency Graph

```
Phase 1: Foundation & Design System
   ↓
Phase 2: Sidebar, Status Bar & Layout Shell
   ↓
Phase 3: Typography, Density & Icons
   ↓
   ├──→ Phase 4: Compose Redesign & Settings
   │       ↓
   │    Phase 5: Activity Feed System
   │       ↓
   │    Phase 9: Pipeline Dashboard ──→ Phase 10: Bottom Panel
   │
   ├──→ Phase 6: Drafts — Master-Detail
   │       ↓
   │    Phase 7: Tracking & Closed — Tables
   │       ↓
   │    Phase 8: Replies — Three-Pane
   │
   └──→ Phase 11: Custom Title Bar
           ↓
        Phase 12: Keyboard Shortcuts & Command Palette
           ↓
        Phase 13: Context Menus & Native Interactions
           ↓
        Phase 14: Polish & Advanced Features
```

**Notes on the graph:**
- Phases 4-5 (Compose + Activity Feed) and Phases 6-8 (page redesigns) can theoretically be done in parallel (by different sessions), but the recommended sequential order is as listed above.
- Phase 9 (Pipeline) depends on Phase 5 (Activity Feed) because the Pipeline page reuses the ActivityFeed component and the activity step IPC events.
- Phase 10 (Bottom Panel) depends on Phase 9 because the Queue tab mirrors Pipeline data.
- Phase 11 (Title Bar) is mostly independent but benefits from being after the layout is stable.
- Phases 12-14 are best done last since they integrate with all pages.

---

## Estimated Scope Per Phase

| Phase | Key Changes | New Files | Complexity |
|-------|------------|-----------|------------|
| 1 | CSS variables, viewport model | 0 | Low-Medium |
| 2 | Sidebar, status bar, layout restructure | 2 | High |
| 3 | Icon replacement, typography, density | 0 | Medium (large but mechanical) |
| 4 | Compose redesign, Settings page | 1 | Medium |
| 5 | Activity Feed component + backend IPC | 1 | High |
| 6 | SplitPane, Toolbar, Drafts master-detail | 2 | High |
| 7 | Tracking table, Closed table | 0 | Medium |
| 8 | Replies three-pane layout | 0 | High |
| 9 | Pipeline page + backend queue changes | 1 | High |
| 10 | Bottom Panel with tabs | 1 | Medium |
| 11 | Custom title bar + window config | 0-1 | Medium |
| 12 | Keyboard shortcuts, command palette | 1 | Medium |
| 13 | Context menus, native dialogs | 0-1 | Medium |
| 14 | Drag & drop, dark theme, polish | 0 | Medium |
