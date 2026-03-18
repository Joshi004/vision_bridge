# VisionBridge: Desktop UX Transformation Analysis

## Executive Summary

VisionBridge currently looks and feels like a single-page web application rendered inside an Electron shell rather than a native desktop application. The experience — narrow centered content, a browser-style top nav bar, full-page scrolling, web-like forms, no use of horizontal space, no keyboard-first workflows, and the absence of native desktop patterns — makes it indistinguishable from a website.

This document provides a detailed diagnosis of every area that contributes to the "web page" feeling and prescribes specific, concrete changes to transform VisionBridge into something that genuinely feels like a desktop application.

---

## Table of Contents

1. [Current State Diagnosis](#1-current-state-diagnosis)
2. [Layout & Spatial Architecture](#2-layout--spatial-architecture)
3. [Navigation Overhaul](#3-navigation-overhaul)
4. [Window Chrome & Title Bar](#4-window-chrome--title-bar)
5. [Page-by-Page Redesign](#5-page-by-page-redesign)
6. [Activity Feed: Replacing Raw Logs with Step-by-Step Progress](#6-activity-feed-replacing-raw-logs-with-step-by-step-progress)
7. [Pipeline Dashboard: Centralized Job Visibility](#7-pipeline-dashboard-centralized-job-visibility)
8. [Data Display: From Cards to Tables](#8-data-display-from-cards-to-tables)
9. [Panels, Panes & Split Views](#9-panels-panes--split-views)
10. [Keyboard-First Interaction](#10-keyboard-first-interaction)
11. [Context Menus & Native Interactions](#11-context-menus--native-interactions)
12. [Toolbars & Action Bars](#12-toolbars--action-bars)
13. [Typography, Iconography & Visual Density](#13-typography-iconography--visual-density)
14. [Status Bar](#14-status-bar)
15. [Modals, Dialogs & Notifications](#15-modals-dialogs--notifications)
16. [Drag & Drop](#16-drag--drop)
17. [Color, Theming & Visual Identity](#17-color-theming--visual-identity)
18. [Scrolling & Overflow](#18-scrolling--overflow)
19. [Implementation Priority](#19-implementation-priority)

---

## 1. Current State Diagnosis

### What Makes It Feel Like a Web Page

| Problem | Current Implementation | Desktop Expectation |
|---------|----------------------|---------------------|
| **Narrow centered content** | All pages use `max-width: 760px; margin: 0 auto` — content floats in a narrow column with massive empty space on both sides | Content should fill the available window, using the full width productively |
| **Browser-style top nav** | Horizontal `<nav>` with pill-shaped links in a sticky header — identical to SaaS web apps | Sidebar navigation, or a compact top toolbar that doesn't waste vertical space |
| **Full-page scrolling** | The entire page scrolls like a web page; no fixed regions | Fixed sidebar + fixed toolbar, only the content area scrolls |
| **Card-based data display** | Leads are shown as vertically stacked cards (one per row) — a pattern from mobile-first web design | Data tables / list views with columns, sortable headers, inline editing |
| **Web-style forms** | Large form fields with generous padding, rounded corners, big labels | Compact, dense forms with inline labels, tighter spacing |
| **No keyboard shortcuts** | Only one shortcut (Cmd+Shift+L for login). No way to navigate, select, or act without a mouse | Keyboard shortcuts for every common action; keyboard-navigable lists |
| **No context menus** | Right-click does nothing; all actions are inline buttons | Right-click on any lead/card shows contextual actions |
| **No sidebar** | All navigation in a top bar; no persistent structure on the left | Left sidebar with navigation items, collapsible sections |
| **No status bar** | No persistent information at the bottom of the window | Status bar showing connection status, queue progress, counts |
| **No split views** | Single-column layout; selecting a lead replaces the whole view | Master-detail split: list on left, detail on right |
| **No drag & drop** | Cannot reorder, move, or reorganize anything | Drag leads between stages, reorder items |
| **Unicode icons** | Using ✓, ✗, ↻, ▾ characters instead of proper icons | Proper SVG icon library (Lucide, Phosphor, Tabler) |
| **Web-like transitions** | CSS hover transitions on everything; no route transitions | Subtle, purposeful animations; instant interactions |
| **Light gray background** | `#f5f5f5` body background — classic web SaaS pattern | Flat backgrounds with clear panel boundaries, or a dark sidebar |
| **No native dialogs** | Custom overlay modals with backdrop blur | Use native `dialog` elements or purpose-built desktop dialog patterns |
| **Responsive breakpoint** | Has a `@media (max-width: 700px)` rule — desktop apps don't need this | Desktop apps should be designed for minimum ~1000px width; no need for mobile breakpoints |
| **Raw log dump on Compose** | Every log line (INFO, DEBUG, ERROR) from every backend component is streamed to the UI in a monospace scrolling panel — dozens of lines per scrape | Users need to see *what step is happening*, not raw log output. Show high-level progress steps; keep raw logs in backend files |
| **No pipeline visibility** | The only pipeline indicator is "5 tasks queued" in the header — no breakdown of what those jobs are, what type, what stage, or which lead they belong to | A dedicated Pipeline/Jobs page showing every queued, active, completed, and failed job with type, target lead, timestamps, and status |

---

## 2. Layout & Spatial Architecture

### Current Layout

```
┌──────────────────────────────────────────────────────┐
│ [Logo]  Compose  Drafts  Tracking  Replies  Closed   │  <- sticky header
├──────────────────────────────────────────────────────┤
│                                                      │
│          ┌──────────────────────┐                     │
│          │  Content (760px)     │                     │  <- narrow centered
│          │  ...scrolls...       │                     │     column
│          └──────────────────────┘                     │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### Proposed Desktop Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ ● ● ●   VisionBridge               Queue: 3 tasks    ─  □  ✕   │  <- custom title bar
├────────┬──────────────────────────────────────────────┬──────────┤
│        │  [Toolbar: actions for current view]         │          │
│  ☰     ├──────────────────────┬───────────────────────┤          │
│        │                      │                       │          │
│ Compose│   List / Table       │   Detail Panel        │          │
│ Drafts │   (scrolls           │   (scrolls            │          │
│Tracking│    independently)    │    independently)     │          │
│Replies │                      │                       │          │
│ Closed │                      │                       │          │
│        │                      │                       │          │
│────────│                      │                       │          │
│Pipeline├──────────────────────┴───────────────────────┤          │
│────────│  [Logs]  [Queue]  [Output]                   │          │
│Settings│  Bottom panel — raw logs, queue detail, etc. │          │
│        │  (collapsible, resizable)                    │          │
├────────┴──────────────────────────────────────────────┴──────────┤
│ 🟢 LinkedIn: Connected │ Pipeline: 1 active, 4 queued │ 42 leads│  <- status bar
└──────────────────────────────────────────────────────────────────┘
```

### Key Changes

1. **Left sidebar for navigation** — always visible, ~200px wide, collapsible to ~48px icon-only mode
2. **Master-detail split** — on Drafts, Tracking, Replies, and Closed pages, the left pane shows a compact list, the right pane shows the selected item's detail
3. **Full-width content** — remove `max-width: 760px`, content fills the available space
4. **Fixed regions** — sidebar and toolbar are fixed; only the content area scrolls
5. **Status bar** — persistent bottom bar with system state
6. **Custom title bar** — integrate window controls and app branding into a unified title bar

---

## 3. Navigation Overhaul

### Current: Horizontal Nav Bar (Web Pattern)

The current nav is a horizontal row of text links — `Compose | Drafts | Tracking | Replies | Closed` — inside a sticky header. This is the standard SaaS web app navigation pattern.

### Proposed: Vertical Sidebar (Desktop Pattern)

**Structure:**

```
┌─────────────────────┐
│  🔷 VisionBridge    │  <- app identity
│─────────────────────│
│  ✦  Compose         │  <- navigation items
│  📝 Drafts     (12) │     with icons and
│  📍 Tracking    (3) │     count badges
│  💬 Replies     (1) │
│  ✅ Closed     (28) │
│─────────────────────│
│  🔄 Pipeline    (5) │  <- pipeline/jobs
│─────────────────────│
│                     │
│  (spacer)           │
│                     │
│─────────────────────│
│  ⚙  Settings        │  <- bottom-anchored
│  📁 Open Logs       │     utility items
└─────────────────────┘
```

**Specific Changes:**

- **Width:** 200px expanded, 48px collapsed (icon-only mode)
- **Collapse toggle:** A chevron button at the bottom of the sidebar, or by dragging the sidebar edge
- **Active state:** A left border accent (3px solid primary color) + background highlight, not a pill
- **Icons:** Each nav item gets a proper SVG icon from an icon library (Lucide recommended)
- **Badges:** Count badges right-aligned, same as current nav-badge but in sidebar context
- **Overdue indicator:** The Tracking item should have an orange/red dot or badge when overdue items exist
- **Dividers:** Visual separation between main navigation and utility items
- **Hover:** Subtle background tint on hover, not the web-style rounded pill hover
- **Animation:** Sidebar collapse/expand should animate smoothly (200ms ease-out)
- **Keyboard:** `Cmd/Ctrl+1` through `Cmd/Ctrl+5` to switch between pages; `Cmd/Ctrl+,` for Settings

**What to Remove:**

- The entire `.app-header` / `.app-header-inner` / `.app-nav` / `.nav-link` system
- The logo from the top bar (moves into sidebar or title bar)
- The `QueueIndicator` from the header (moves to status bar)

---

## 4. Window Chrome & Title Bar

### Current: Default OS Title Bar

The app uses the default Electron title bar (`frame: true` by default). This results in the standard OS chrome with no branding, and the app header below it wastes vertical space.

### Proposed: Custom Title Bar

**On macOS:**

```
┌──────────────────────────────────────────────────────────┐
│ ● ● ●    VisionBridge    ┊    🔍 Search leads (⌘K)      │
└──────────────────────────────────────────────────────────┘
```

**On Windows:**

```
┌──────────────────────────────────────────────────────────┐
│ 🔷 VisionBridge    ┊    🔍 Search leads (Ctrl+K)   ─ □ ✕│
└──────────────────────────────────────────────────────────┘
```

**Implementation:**

- Set `titleBarStyle: 'hiddenInset'` on macOS, `titleBarOverlay: true` on Windows in the `BrowserWindow` options
- Create a custom `<div className="titlebar">` with `-webkit-app-region: drag` for the draggable area
- Integrate a **command palette / search** into the title bar (Cmd/Ctrl+K to search across all leads)
- Keep the title bar height to 32-38px — compact and functional
- On macOS, leave 70px padding on the left for traffic light buttons

---

## 5. Page-by-Page Redesign

### 5.1 Compose Page

**Current Problems:**
- Sender config is a big form that dominates the page
- Single/Bulk mode toggle looks like a web segmented control
- The URL input + Go button looks like a web search bar
- Everything is stacked vertically in a narrow column
- Raw diagnostic logs (every INFO/DEBUG/ERROR line from every backend component) are dumped inline — users see dozens of noisy log lines when they only need to know what step is currently executing

**Proposed Changes:**

- **Sender config** should move to a **Settings page** or a **collapsible panel on the right**. It's configuration, not a daily workflow — it shouldn't be on the main compose screen.
- **Compose view** becomes a clean, focused workspace:
  - A prominent URL input bar at the top (think Spotlight / Alfred style — centered, minimal)
  - Below it, a compact toggle between Single and Bulk mode
  - For Bulk mode: a split view — URL list on the left, progress/results on the right
  - For Single mode: the profile result appears in a side panel, not stacked below
- **Replace the raw log panel with an Activity Feed** — see [Section 6: Activity Feed](#6-activity-feed-replacing-raw-logs-with-step-by-step-progress) for the full design. Instead of streaming every log line, show a clean step-by-step progress indicator: "Scraping profile...", "Extracting about section...", "Reading posts...", etc.
- **Full raw logs stay in the backend** — written to log files on disk as they already are. Users can access them via a "View Logs" action that opens the log file or shows them in the bottom panel.
- Remove the `.container` max-width constraint

### 5.2 Drafts Page

**Current Problems:**
- Vertically stacked cards with full-width editor, one per row
- The whole page scrolls; selecting a card expands it inline (accordion pattern — very web-like)
- Action buttons are scattered across each card
- No way to see multiple drafts at a glance

**Proposed Changes:**

- **Master-detail split view:**
  - **Left pane (list):** Compact rows showing name, role, persona tag, and status. No editor visible. Clicking a row selects it.
  - **Right pane (detail):** Shows the full detail of the selected lead — conversation preview, draft editor, action buttons
- **Multi-select:** Checkboxes in the list pane for bulk actions
- **Toolbar above the list:** Select All, Refresh All, Search/Filter, Sort dropdown
- **Bulk action bar:** Appears in the toolbar area when items are selected, not as a floating bottom bar
- **Draft editor:** In the detail pane, the textarea should have a proper toolbar above it (Regenerate, Restore, word count)
- **Keyboard navigation:** Up/Down arrows move selection, Enter opens for editing, Delete prompts deletion

### 5.3 Tracking Page

**Current Problems:**
- Same card-stack layout as Drafts
- Filters (sort, filter, date range) use web-style `<select>` dropdowns
- Follow-up modal is a web overlay

**Proposed Changes:**

- **Table view as default:**
  - Columns: Name, Role, Persona, Initial Sent, Follow-ups, Next Due, Last Sent, Status
  - Sortable column headers (click to sort, shift+click for secondary sort)
  - Row coloring for overdue items (subtle red/orange background)
  - Inline actions on hover (Follow-up, Mark Cold, Update) or via right-click context menu
- **Filter bar as a toolbar:** Not dropdowns in the content area — a dedicated toolbar row with segmented buttons for filters
- **Follow-up composer:** Opens in a **right panel or bottom drawer**, not a modal overlay. The user should see the lead's info while composing.
- **Calendar-style overdue indicators:** Show a small calendar icon with the number of days overdue

### 5.4 Replies Page

**Current Problems:**
- Card-based layout with inline conversation thread
- Reply composer is embedded in each card
- Actions (Mark Converted, Mark Cold) are buttons on each card

**Proposed Changes:**

- **Three-pane layout** (inspired by email clients like Outlook/Thunderbird):
  - **Left:** Lead list with unread indicator, name, last reply timestamp
  - **Center:** Conversation thread for the selected lead (full-height scrollable, messages styled as chat bubbles)
  - **Right (optional):** Lead profile details (name, role, tags, timeline)
- **Reply composer** at the bottom of the center pane, always visible — like a chat input
- **Actions** in a toolbar above the conversation: Mark Converted, Mark Cold, Update
- **Keyboard:** Up/Down to navigate leads, Tab to focus the reply input, Enter to send (with Cmd/Ctrl modifier)

### 5.5 Closed Page

**Current Problems:**
- Same card layout
- Simple toggle bar for filter (All/Converted/Cold)

**Proposed Changes:**

- **Table view:**
  - Columns: Name, Role, Outcome (Converted/Cold), Initial Contact, Closed Date, Duration, Follow-ups
  - Row styling: green tint for Converted, gray for Cold
  - Sortable headers
- **Filter as segmented buttons in the toolbar**
- **Reopen action** via right-click context menu or a toolbar button when a row is selected
- **Summary statistics** at the top: total closed, conversion rate, average time-to-close (displayed as metric cards in the toolbar area)

---

## 6. Activity Feed: Replacing Raw Logs with Step-by-Step Progress

### The Problem

When a user triggers a scrape on the Compose page, the app currently streams **every single log line** from the backend directly into a monospace scrolling panel. A single profile scrape produces dozens of log entries from components like `scraper`, `about`, `experience`, `education`, `recommendations`, `messages`, `posts`, `summarizer`, `ipc/scrape` — mixing INFO, DEBUG, and ERROR levels. The user sees output like:

```
[2026-03-16T10:23:01.123Z] [INFO ] [scraper] Starting profile scrape for linkedin.com/in/john-doe
[2026-03-16T10:23:01.456Z] [DEBUG] [scraper] Navigating to profile URL
[2026-03-16T10:23:03.789Z] [DEBUG] [about] Checking for see-more button
[2026-03-16T10:23:04.012Z] [DEBUG] [about] See-more button found, clicking
[2026-03-16T10:23:04.345Z] [INFO ] [about] Extracted about text (234 chars)
[2026-03-16T10:23:04.678Z] [DEBUG] [experience] Scrolling to experience section
...
```

This is **developer-facing output**, not user-facing feedback. A user doesn't care about see-more buttons or character counts — they want to know: "What step is the system on right now?"

### The Solution: Two-Tier Logging Architecture

**Tier 1 — Activity Feed (user-facing):** A high-level, human-readable sequence of steps shown in the UI. Each step represents a meaningful phase of work.

**Tier 2 — Raw Logs (developer-facing):** The full, detailed log output stays entirely in the backend, written to log files on disk. Accessible from the UI on demand, but never shown by default.

### Activity Feed Design

#### What the User Sees During a Scrape

Instead of a monospace log dump, the Compose page shows a clean **step list** — a vertical sequence of steps, each with a status indicator:

```
┌────────────────────────────────────────────────────┐
│  Activity                                          │
│                                                    │
│  ✓  Loading profile page                           │
│  ✓  Extracting about section                       │
│  ✓  Extracting experience & education              │
│  ✓  Reading recommendations                        │
│  ●  Analyzing recent posts...              (12s)   │  <- currently active
│  ○  Scraping message history                       │  <- pending
│  ○  Generating outreach draft                      │
│                                                    │
│  ─────────────────────────────────────────────      │
│  Total time: 24s        [View Full Logs]           │
└────────────────────────────────────────────────────┘
```

#### Step States

| Icon | State | Meaning |
|------|-------|---------|
| `○` | Pending | Not started yet |
| `●` (animated pulse) | Active | Currently executing |
| `✓` (green) | Completed | Finished successfully |
| `✗` (red) | Failed | Encountered an error |
| `⊘` (gray) | Skipped | Not applicable for this profile |

#### Step Definitions

The scrape process is broken down into these user-visible steps:

| Step | Triggered When | Components Involved |
|------|---------------|---------------------|
| Loading profile page | Scrape starts, page navigation begins | `scraper` |
| Extracting about section | About section parsing starts | `about` |
| Extracting experience & education | Experience/education sections parsed | `experience`, `education` |
| Reading recommendations | Recommendations section parsed | `recommendations` |
| Analyzing recent posts | Activity/posts page is scraped | `posts` |
| Scraping message history | Message overlay opened and parsed | `messages` |
| Generating outreach draft | LLM summarizer and draft generation starts | `summarizer`, `ipc/scrape` |
| Saving lead to database | Lead record created in DB | `ipc/scrape` |

For **send** operations (send-initial, send-followup, send-reply):

| Step | Triggered When |
|------|---------------|
| Preparing message | Message formatted for sending |
| Opening LinkedIn messaging | Browser navigates to messaging |
| Sending message | Message typed and sent |
| Confirming delivery | Delivery verified |
| Updating lead status | Database updated |

#### Implementation: New IPC Channel for Activity Steps

**Backend change:** Introduce a new IPC channel `scrape:activity` (separate from `scrape:log`) that sends structured step updates:

```typescript
interface ActivityStep {
  stepId: string           // e.g. "extract-about", "analyze-posts"
  label: string            // Human-readable: "Extracting about section"
  status: 'pending' | 'active' | 'completed' | 'failed' | 'skipped'
  detail?: string          // Optional short detail: "234 characters extracted"
  error?: string           // Error message if failed
  startedAt?: number       // Timestamp when step became active
  completedAt?: number     // Timestamp when step completed
}
```

The backend emits one `ActivityStep` update each time a step transitions (pending → active, active → completed, etc.). The renderer keeps a list of steps and updates their status reactively.

**The existing `scrape:log` channel continues to work exactly as before** — it writes to the log file on disk. The renderer simply stops subscribing to it by default.

#### Accessing Raw Logs from the UI

Raw logs should still be accessible when needed:

1. **"View Full Logs" link** — at the bottom of the activity feed. Clicking this opens the bottom panel (see [Section 9: Panels](#9-panels-panes--split-views)) with a dedicated "Logs" tab showing the full raw log stream in monospace format.
2. **"Open Logs Folder" button** — opens the OS file manager at the `{userData}/logs/` directory (already implemented via `IPC.OPEN_LOGS_FOLDER`).
3. **Bottom panel Logs tab** — when the bottom panel is open, a "Logs" tab streams `scrape:log` events in real time, exactly like the current diagnostic panel but moved out of the main content area. This is opt-in — the user explicitly opens it when they want to debug.

#### Activity Feed in Bulk Mode

During bulk scraping, the activity feed shows a **per-URL step summary** integrated into the existing URL list:

```
┌────────────────────────────────────────────────────────────────┐
│  Bulk Progress — 3 / 10 done                                  │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━░░░░░░░░░░░░░░░░░░░░   30%    │
│                                                                │
│  ✓  linkedin.com/in/john-doe        John Doe           4.2s   │
│  ✓  linkedin.com/in/jane-smith      Jane Smith         6.1s   │
│  ✓  linkedin.com/in/bob-j           Bob Johnson        3.8s   │
│  ●  linkedin.com/in/alice-w         Analyzing posts... ──     │  <- active, shows current step
│  ○  linkedin.com/in/charlie-b       Pending                   │
│  ○  linkedin.com/in/dave-m          Pending                   │
│  ...                                                           │
└────────────────────────────────────────────────────────────────┘
```

The key change: instead of just showing "processing" for the active URL, show **which step** is currently executing (e.g., "Analyzing posts..."). This gives users meaningful real-time feedback without raw log noise.

---

## 7. Pipeline Dashboard: Centralized Job Visibility

### The Problem

VisionBridge has two internal queues (`dataQueue` and `actionQueue`) that process seven different job types:

| Job Type | Queue | Description |
|----------|-------|-------------|
| `scrape-profile` | data | Scrape a LinkedIn profile and generate draft |
| `refresh-profile` | data | Re-scrape an existing lead's profile |
| `refresh-both` | data | Re-scrape profile and regenerate draft |
| `check-replies` | data | Check for new replies from a lead |
| `send-initial` | action | Send the initial outreach message |
| `send-followup` | action | Send a follow-up message |
| `send-reply` | action | Send a reply to a lead's response |

The only visibility into this pipeline today is a tiny badge in the header: **"Processing 5 tasks…"** or **"5 tasks queued"**. The user has no way to know:

- What those 5 tasks are
- Which lead each task is for
- What type of work each task does (scrape vs. send vs. check)
- How long each task has been running or waiting
- Whether any tasks have failed (and what the error was)
- The order in which tasks will be processed

This is a significant blind spot, especially when the user has submitted a bulk scrape of 20 URLs and also has 3 follow-ups queued and a reply being sent. They have no idea what's happening inside the system.

### The Solution: A Dedicated Pipeline Page

Add a new **Pipeline** page (accessible from the sidebar) that provides full visibility into the queue system. This is the equivalent of a "Jobs" or "Activity Monitor" view — a pattern common in desktop applications like CI/CD tools, database managers, and download managers.

### Pipeline Page Layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Pipeline                                                       [⟳ Refresh] │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │  Summary                                                               │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │  │
│  │  │ Active   │  │ Queued   │  │Completed │  │ Failed   │  │Cancelled│ │  │
│  │  │    1     │  │    4     │  │   23     │  │    2     │  │    0    │ │  │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └─────────┘ │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  Filter: [All ▾]  [All Types ▾]  [All Queues ▾]         [Clear Completed]  │
│                                                                              │
│  ┌──┬──────┬──────────────┬────────────────┬──────────┬────────┬──────────┐ │
│  │  │ Type │ Target       │ Queue          │ Status   │ Time   │ Actions  │ │
│  ├──┼──────┼──────────────┼────────────────┼──────────┼────────┼──────────┤ │
│  │● │ 🔍   │ John Doe     │ Data           │ Active   │ 12s    │ Cancel   │ │
│  │○ │ 📨   │ Jane Smith   │ Action         │ Queued   │ —      │ Cancel   │ │
│  │○ │ 📨   │ Bob Johnson  │ Action         │ Queued   │ —      │ Cancel   │ │
│  │○ │ 🔍   │ Alice Wong   │ Data           │ Queued   │ —      │ Cancel   │ │
│  │○ │ 💬   │ Charlie B    │ Action         │ Queued   │ —      │ Cancel   │ │
│  │─ │──────│──────────────│────────────────│──────────│────────│──────────│ │
│  │✓ │ 🔍   │ Dave Miller  │ Data           │ Done     │ 8.4s   │ Retry    │ │
│  │✓ │ 📨   │ Eve Torres   │ Action         │ Done     │ 14.2s  │          │ │
│  │✗ │ 🔍   │ Frank Lee    │ Data           │ Failed   │ 6.1s   │ Retry    │ │
│  │  │      │              │ Error: Timeout │          │        │          │ │
│  └──┴──────┴──────────────┴────────────────┴──────────┴────────┴──────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Pipeline Page Components

#### Summary Cards

A row of compact metric cards at the top showing aggregate counts by status:

| Card | Color | Count |
|------|-------|-------|
| **Active** | Blue with pulse animation | Jobs currently being processed |
| **Queued** | Neutral gray | Jobs waiting to be processed |
| **Completed** | Green | Successfully finished jobs (recent session) |
| **Failed** | Red | Jobs that encountered errors |
| **Cancelled** | Muted gray | Jobs that were cancelled by the user |

These update in real time via the existing `queue.onProgress` IPC events.

#### Filter & Control Bar

A toolbar above the job table with:

- **Status filter:** All / Active / Queued / Completed / Failed / Cancelled
- **Type filter:** All Types / Scrape / Send / Follow-up / Reply / Refresh / Check Replies
- **Queue filter:** All Queues / Data Queue / Action Queue
- **Clear Completed:** Button to remove completed jobs from the view (they remain in the backend)
- **Cancel All:** Button to cancel all queued jobs (with confirmation)

#### Job Table

A sortable data table where each row represents one job:

| Column | Content | Notes |
|--------|---------|-------|
| **Status Icon** | ●/○/✓/✗/⊘ | Same icon language as Activity Feed |
| **Type** | Icon + label | 🔍 Scrape, 📨 Send, 🔄 Follow-up, 💬 Reply, 🔃 Refresh, 👁 Check |
| **Target** | Lead name or URL | The lead this job operates on (extracted from `payload.leadId` or `payload.url`) |
| **Queue** | Data / Action | Which internal queue the job belongs to |
| **Status** | Active / Queued / Done / Failed / Cancelled | Text label |
| **Time** | Duration or wait time | For active: elapsed time (counting up). For queued: time waiting. For done: total duration. |
| **Actions** | Cancel / Retry | Cancel for queued/active jobs. Retry for failed jobs. |

**Row behavior:**
- **Active row:** Subtle blue background, pulsing status icon
- **Failed row:** Subtle red background, expandable to show error message
- **Completed row:** Slightly muted/faded text
- **Queued row:** Normal styling, shows position in queue

#### Job Detail (on row click or expand)

Clicking a row expands it to show additional detail:

```
┌──────────────────────────────────────────────────────────────┐
│ ● Scrape Profile — John Doe                          Active  │
│──────────────────────────────────────────────────────────────│
│                                                              │
│  Job ID:      scrape-1710590234-abc123                       │
│  Queue:       Data Queue                                     │
│  Created:     10:23:01 AM                                    │
│  Started:     10:23:04 AM (waited 3s)                        │
│  Elapsed:     12s                                            │
│                                                              │
│  Current Step: Analyzing recent posts...                     │
│                                                              │
│  ✓ Loading profile page                           (2.1s)     │
│  ✓ Extracting about section                       (1.3s)     │
│  ✓ Extracting experience & education              (3.2s)     │
│  ✓ Reading recommendations                        (1.8s)     │
│  ● Analyzing recent posts...                      (4.1s)     │
│  ○ Scraping message history                                  │
│  ○ Generating outreach draft                                 │
│                                                              │
│  [View Raw Logs]  [Cancel Job]                               │
└──────────────────────────────────────────────────────────────┘
```

This expanded view **reuses the same Activity Feed step-list** from Section 6 — providing per-job step visibility directly in the Pipeline page. The "View Raw Logs" button opens the raw log output for this specific job in the bottom panel.

### Real-Time Updates

The Pipeline page subscribes to the same `queue.onProgress` IPC events that the current `QueueIndicator` uses, but renders far more detail:

1. **On `job-status-change`:** Update the row's status, elapsed time, and current activity step
2. **On `queue-drained`:** Optionally show a brief summary notification
3. **On `session-expired`:** Highlight all cancelled jobs with a "Session expired" reason

All updates are live — the table reflects the current state of the pipeline at all times without manual refreshing.

### Integration with the Status Bar

The status bar's queue section becomes a **quick-access summary** that links to the Pipeline page:

```
┌──────────────────────────────────────────────────────────────────────┐
│ 🟢 LinkedIn: Connected  │  Pipeline: 1 active, 4 queued  │  42 leads│
└──────────────────────────────────────────────────────────────────────┘
                                    ↑
                           Click to open Pipeline page
```

When a job fails, the status bar shows an alert indicator:

```
│  Pipeline: 1 active, 4 queued, ⚠ 2 failed  │
```

### Integration with Per-Page Indicators

The existing per-page queue indicators (DraftsPage showing "Sending..." on cards, TrackingPage showing follow-up status) **remain as they are**. They provide contextual, page-specific feedback. The Pipeline page provides the **centralized, cross-cutting view** that ties everything together.

Think of it like this:
- **Per-page indicators** = "This specific draft is being sent" (local context)
- **Pipeline page** = "Here's everything the system is doing right now" (global context)
- **Status bar** = "Quick glance at overall pipeline health" (always visible)

### Backend Changes Required

The existing queue system (`electron/queue.ts`) already tracks most of the needed information in `QueueItemStatus`:

```typescript
interface QueueItemStatus {
  id: string
  queue: 'data' | 'action'
  type: string
  payload: Record<string, unknown>
  status: 'queued' | 'active' | 'completed' | 'failed' | 'cancelled'
  result?: unknown
  error?: string
  createdAt: number
  completedAt?: number
}
```

Additional data needed:

1. **`startedAt` field:** Add a timestamp for when the job transitions from `queued` to `active` (to calculate wait time and elapsed time separately)
2. **Lead name resolution:** The `payload` contains `leadId` or `url`, but the Pipeline page needs the human-readable lead name. Either:
   - Resolve the name in the renderer by maintaining a lead name cache, or
   - Include the lead name in the `payload` when enqueuing the job
3. **Activity step forwarding:** The new `ActivityStep` events (from Section 6) should include the `jobId` so the Pipeline page can show per-job step progress
4. **Job history retention:** Currently, completed/failed/cancelled jobs are cleaned up on drain. For the Pipeline page, keep a configurable number of recent completed jobs (e.g., last 50) so users can see recent history.

---

## 8. Data Display: From Cards to Tables

### Why Cards Feel "Webby"

Cards are a mobile-first, content-first pattern. They work for touch interfaces with variable content lengths. Desktop applications use **dense, scannable data tables** because:

- Users have a mouse and keyboard (precise input)
- Users want to see many items at once (20-50 rows visible)
- Users want to sort, filter, and compare data across rows
- Users want to act on multiple items simultaneously

### Proposed Table Patterns

**Standard List Row (for Drafts, Tracking, Closed):**

```
┌──┬────────────────┬────────────────┬──────────┬──────────┬────────┬─────────┐
│☐ │ Name           │ Role           │ Persona  │ Status   │ Date   │ Actions │
├──┼────────────────┼────────────────┼──────────┼──────────┼────────┼─────────┤
│☐ │ John Smith     │ VP Engineering │ Mgmt     │ Draft    │ Mar 14 │ ••• ▾   │
│☑ │ Jane Doe       │ CTO            │ C-Level  │ Sending… │ Mar 13 │ ••• ▾   │
│☐ │ Bob Johnson    │ Sr. Engineer   │ Top Eng  │ Saved    │ Mar 12 │ ••• ▾   │
└──┴────────────────┴────────────────┴──────────┴──────────┴────────┴─────────┘
```

**Key Properties:**
- Fixed header row (doesn't scroll)
- Alternating row backgrounds (subtle: white / #fafbfc)
- Selected row has a blue left border and light blue background
- Hover row has a very subtle gray background
- Compact row height: 36-40px
- Truncation with ellipsis for long text
- Tooltip on hover for truncated text

---

## 9. Panels, Panes & Split Views

Desktop applications use **split views** extensively. The user should be able to:

### Resizable Split Panes

- **Sidebar ↔ Content:** Drag the sidebar edge to resize (min: 48px, max: 300px)
- **List ↔ Detail:** Drag the divider between list and detail panels (on Drafts, Tracking, Replies, Closed pages)
- **Content ↔ Bottom Panel:** Drag the top edge of the bottom panel (for logs, queue status)

### Bottom Panel / Drawer

A collapsible bottom panel (like VS Code's terminal) for:
- **Raw Logs tab:** The full, unfiltered log stream from the backend (`scrape:log` events) — this is where the detailed developer-facing logs move to (see [Section 6](#6-activity-feed-replacing-raw-logs-with-step-by-step-progress)). Users open this tab only when they need to debug or inspect what happened in detail.
- **Queue tab:** A compact live view of the pipeline queue — a lightweight version of the Pipeline page (see [Section 7](#7-pipeline-dashboard-centralized-job-visibility)) showing currently active and queued jobs without navigating away from the current page.
- **Output tab:** Results from bulk operations, export summaries, etc.

This panel should:
- Be toggleable with a keyboard shortcut (`Cmd/Ctrl+J`)
- Have tabs: Logs | Queue | Output
- Remember its last height
- Be collapsible to just its tab bar
- The Logs tab should support filtering by log level (INFO/DEBUG/ERROR) and by component
- The Queue tab should allow cancelling individual jobs inline

### Detail Panel

When a lead is selected in any list view:
- The detail panel slides in from the right (or is always visible)
- It shows the full lead information: profile, conversation, draft/reply editor, actions
- It has its own scroll context (independent of the list)
- It can be closed with `Escape` or by clicking the selected lead again

---

## 10. Keyboard-First Interaction

Desktop apps are keyboard-driven. Currently, VisionBridge has almost no keyboard support.

### Proposed Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+1` through `6` | Switch between Compose, Drafts, Tracking, Replies, Closed, Pipeline |
| `Cmd/Ctrl+K` | Open command palette / search |
| `Cmd/Ctrl+N` | New lead (focus URL input on Compose) |
| `Cmd/Ctrl+Shift+L` | LinkedIn Login (existing) |
| `Cmd/Ctrl+,` | Open Settings |
| `Cmd/Ctrl+J` | Toggle bottom panel |
| `Cmd/Ctrl+B` | Toggle sidebar |
| `↑ / ↓` | Navigate list items |
| `Enter` | Open selected item / confirm action |
| `Delete / Backspace` | Delete selected item (with confirmation) |
| `Cmd/Ctrl+S` | Save current draft |
| `Cmd/Ctrl+Enter` | Send current draft / reply |
| `Cmd/Ctrl+R` | Refresh current view |
| `Cmd/Ctrl+A` | Select all items in list |
| `Escape` | Close detail panel / cancel current action / deselect |
| `Tab` | Move focus between panes |
| `Space` | Toggle checkbox on focused item |

### Command Palette

A VS Code / Spotlight-style command palette (`Cmd/Ctrl+K`) that allows:
- Searching leads by name across all stages
- Running commands: "Send draft", "Mark as cold", "Refresh all", etc.
- Navigating to any page
- Quick access to settings

---

## 11. Context Menus & Native Interactions

### Right-Click Context Menus

Every lead row/card should have a right-click context menu:

**Drafts context menu:**
```
┌─────────────────────┐
│ Edit Draft           │
│ Regenerate Draft     │
│ ───────────────────  │
│ Send                 │
│ Save Draft           │
│ ───────────────────  │
│ Refresh Profile      │
│ Refresh Draft        │
│ Refresh Both         │
│ ───────────────────  │
│ Copy Draft Text      │
│ Open LinkedIn Profile│
│ ───────────────────  │
│ Delete            ⌫  │
└─────────────────────┘
```

**Implementation:** Use Electron's `Menu.buildFromTemplate()` via IPC to create native context menus, or use a high-quality React context menu library that matches OS conventions.

### Double-Click

- Double-click a lead row to open it in the detail panel (or to start editing the draft)

### Drag & Drop

- Drag leads between stages (e.g., drag from Drafts to Closed)
- This is a secondary feature — not critical for initial transformation, but adds significantly to desktop feel

---

## 12. Toolbars & Action Bars

### Current: Scattered Inline Actions

Actions are currently inline on each card: buttons like "Save Draft", "Delete", "Send", "Regenerate" appear on every card. This is a mobile/web pattern.

### Proposed: Centralized Toolbar

A toolbar row below the title bar (or at the top of the content area) that is **contextual to the current page and selection**:

**Drafts Toolbar:**
```
┌────────────────────────────────────────────────────────────────────────┐
│ ☑ Select All  │  🔄 Refresh All  │  [Search... 🔍]  │  Sort: Name ▾  │
├────────────────────────────────────────────────────────────────────────┤
│ When items selected:                                                   │
│ Send (3)  │  Delete (3)  │  Regenerate (3)  │  Deselect All           │
└────────────────────────────────────────────────────────────────────────┘
```

**Key Principles:**
- Toolbar is always in the same position (no floating bars)
- Actions are disabled/enabled based on selection state
- Bulk actions appear in the same toolbar when items are selected (not in a separate floating bar)
- Each action shows the count of affected items
- Toolbar buttons should be compact: icon + short label, 28-32px height

---

## 13. Typography, Iconography & Visual Density

### Typography

**Current:** Web-style spacing with large font sizes (28px headings, 14-15px body, generous line-height 1.5-1.7)

**Proposed:**
- **Page headings:** 16-18px, semibold — desktop apps use smaller headings
- **Body text:** 13px — the standard for dense desktop UIs
- **Labels:** 11-12px, uppercase with tracking — for section labels and metadata
- **Monospace:** Keep for logs and code, but at 12px
- **Line height:** 1.3-1.4 for general text, 1.5 for editable textareas
- **Font family:** Keep the system font stack; it's correct for a desktop app

### Iconography

**Current:** Unicode characters (✓, ✗, ↻, ▾, ▸, ✦, ✕, ⊘)

**Proposed:**
- Adopt **Lucide React** (`lucide-react`) — it's lightweight, tree-shakable, and has a clean aesthetic
- Every navigation item, button, and action should have a proper icon
- Icon sizes: 16px for inline/buttons, 20px for navigation, 14px for table actions
- Consistent stroke width across all icons

### Visual Density

**Current:** Web-like generous spacing:
- Container padding: 32px/16px/64px
- Card padding: 16px-24px
- Button padding: 10px 18px
- Gap between items: 10-16px

**Proposed:** Desktop-appropriate density:
- Container padding: 12px-16px
- List item padding: 8px 12px
- Button padding: 6px 12px
- Gap between items: 4-8px
- Form field padding: 6px 10px
- Overall reduction in whitespace by ~40%

---

## 14. Status Bar

### Current: No Status Bar

There is no persistent bottom bar. Queue status is in the header.

### Proposed: Full-Width Status Bar

```
┌──────────────────────────────────────────────────────────────────────┐
│ 🟢 LinkedIn: Connected  │  Queue: 2/5 processing  │  42 total leads │
└──────────────────────────────────────────────────────────────────────┘
```

**Contents:**
- **Left:** LinkedIn session status (Connected / Expired / Unknown) with colored indicator
- **Center:** Pipeline status — replaces the current header `QueueIndicator` with a richer summary: "Pipeline: 1 active, 4 queued" (and "⚠ 2 failed" when failures exist)
- **Right:** Aggregate statistics (total leads, or counts per stage)

**Properties:**
- Fixed to the bottom of the window
- Height: 24-28px
- Small font (11-12px)
- Subtle background (slightly darker than content area)
- Clicking on pipeline status navigates to the Pipeline page (see [Section 7](#7-pipeline-dashboard-centralized-job-visibility))
- Clicking on LinkedIn status navigates to login
- When jobs are actively processing, the pipeline section shows a subtle animated indicator

---

## 15. Modals, Dialogs & Notifications

### Current Patterns

- **Overlay modals:** `.bulk-dialog-overlay` and `.fu-modal-backdrop` with web-style centered boxes
- **Inline confirmations:** `.drafts-confirm` for delete/send confirmation
- **Banners:** Session expired, error, success banners inline in the page
- **Toast:** `.tracking-toast` fixed at bottom center

### Proposed Changes

**Modals → Panels or Native Dialogs:**
- The bulk delete confirmation should use a **native Electron `dialog.showMessageBox()`** — it's destructive and deserves a real OS dialog
- The follow-up composer should be a **right panel** or a **bottom drawer**, not a modal
- The send confirmation should be inline (current approach is fine) or a quick toast

**Notifications:**
- Use **native OS notifications** (Electron `Notification` API) for background events (already partially done for queue draining)
- Replace toast messages with a **notification center** in the status bar: a small icon that shows a count of recent notifications, clickable to see history

**Banners → Status Bar:**
- The session expired banner should be an indicator in the status bar (orange/red) + a native notification, not a full-width banner that pushes content down
- Error states should be in the status bar or a brief toast, not large inline banners

---

## 16. Drag & Drop

### Current: None

### Proposed (Phase 2)

- **Drag leads between stages:** From the sidebar or between pages. For example, drag a draft to "Closed" to mark it as cold.
- **Reorder leads:** Drag to reorder within a list (priority ordering)
- **Drag to compose:** Drag a LinkedIn URL from the browser onto the app window to start composing

These are advanced features that significantly enhance the desktop feel but should come after the core layout transformation.

---

## 17. Color, Theming & Visual Identity

### Current Color Issues

- `background: #f5f5f5` on body — this is the classic web SaaS background
- White cards on gray background — strong card-based web pattern
- LinkedIn blue (`#0077b5`) used as primary everywhere — fine, but could be more branded

### Proposed Changes

**Light Theme:**
- **Window background:** `#f0f1f3` (slightly cooler gray)
- **Sidebar background:** `#1e1e2e` or `#252836` (dark sidebar, common in desktop apps like Slack, Discord, Spotify)
- **Sidebar text:** `#ccd0d8` (muted white)
- **Sidebar active:** Left border accent in primary blue + slightly lighter background
- **Content background:** `#ffffff` (flat white, no gray)
- **Panel backgrounds:** `#fafbfc` for secondary panels
- **Borders:** `#e1e4e8` (GitHub-style border gray)
- **Title bar:** Match sidebar color or use `#f6f8fa`
- **Status bar:** `#f6f8fa` or match sidebar

**Dark Theme (Future):**
- Desktop apps are expected to support dark mode
- This can be implemented later, but the CSS architecture should use CSS custom properties (`var(--bg-primary)`, etc.) from the start to make theming trivial

### CSS Custom Properties

Replace all hardcoded colors with CSS variables:

```css
:root {
  --bg-app: #f0f1f3;
  --bg-sidebar: #1e1e2e;
  --bg-content: #ffffff;
  --bg-panel: #fafbfc;
  --bg-hover: #f3f4f6;
  --bg-selected: #e8f0fe;
  --border-default: #e1e4e8;
  --border-strong: #d0d3d9;
  --text-primary: #1a1a1a;
  --text-secondary: #57606a;
  --text-muted: #8b949e;
  --accent-primary: #0077b5;
  --accent-success: #16a34a;
  --accent-danger: #dc2626;
  --accent-warning: #f59e0b;
}
```

---

## 18. Scrolling & Overflow

### Current: Page-Level Scrolling

The whole page scrolls — the header is sticky, but everything else moves. This is a web pattern.

### Proposed: Panel-Level Scrolling

- **Sidebar:** Never scrolls (unless there are too many items — then it scrolls independently)
- **Title bar:** Never scrolls
- **Toolbar:** Never scrolls
- **Status bar:** Never scrolls
- **List panel:** Scrolls independently (shows its own scrollbar)
- **Detail panel:** Scrolls independently
- **Bottom panel:** Scrolls independently

**CSS approach:**
- Use `height: 100vh` on the app container
- Use `overflow: hidden` on the body
- Use `overflow-y: auto` on individual scrollable panels
- Each panel should have `flex: 1; min-height: 0; overflow-y: auto`

This is the single most important change to make the app feel like a desktop app. When the window becomes a fixed frame with only specific regions scrolling, it immediately stops feeling like a web page.

---

## 19. Implementation Priority

### Phase 1: Core Layout Transformation (Highest Impact)

These changes alone will transform the "web page" feeling into a "desktop app" feeling:

1. **Switch from page-level scrolling to panel-level scrolling** — `overflow: hidden` on body, `overflow-y: auto` on content panels
2. **Replace horizontal nav with vertical sidebar** — dark sidebar with icons, including Pipeline entry
3. **Remove max-width constraints** — content fills available space
4. **Add a status bar** — move queue indicator down, add session and pipeline status
5. **Add CSS custom properties** — prep for theming
6. **Increase visual density** — reduce padding, font sizes, and spacing by ~30-40%

### Phase 2: Activity Feed & Pipeline Visibility

These are high-value feature changes that solve real usability gaps:

7. **Replace raw log panel with Activity Feed** — introduce `scrape:activity` IPC channel, define step definitions for each operation type, build the step-list UI component on Compose page. Raw logs continue writing to disk and move to the bottom panel's Logs tab.
8. **Build the Pipeline Dashboard page** — new route `/pipeline`, job table with real-time updates from `queue.onProgress`, summary cards, filters, per-job detail expansion with activity steps, cancel/retry actions
9. **Add `startedAt` to QueueItemStatus** — backend change to track when jobs begin processing (for elapsed/wait time display)
10. **Integrate pipeline status into the status bar** — clickable "Pipeline: 1 active, 4 queued" that navigates to the Pipeline page

### Phase 3: Data Display & Interaction

11. **Master-detail split view** — on Drafts, Tracking, Replies, Closed pages
12. **Convert card lists to compact list/table rows** — sortable, selectable
13. **Add right-click context menus** — via Electron IPC or React library
14. **Add keyboard shortcuts** — page navigation, list navigation, common actions
15. **Adopt an icon library** — replace all Unicode characters with Lucide icons

### Phase 4: Window & Native Integration

16. **Custom title bar** — integrate branding and search
17. **Command palette** (Cmd/Ctrl+K) — search across leads and commands
18. **Bottom panel / drawer** — with Logs, Queue, and Output tabs
19. **Resizable split panes** — draggable dividers between panels
20. **Move sender config to Settings page** — declutter Compose

### Phase 5: Polish & Advanced Features

21. **Native dialogs** for destructive confirmations
22. **Drag & drop** between stages
23. **Dark theme** support
24. **Page transitions** — subtle slide/fade when switching pages
25. **Notification center** — in status bar

---

## Appendix: Reference Applications

Study these desktop applications for UX patterns to emulate:

| Application | What to Learn |
|-------------|--------------|
| **VS Code** | Sidebar, command palette, panel system, status bar, keyboard-first |
| **Slack** | Dark sidebar, conversation list + detail, compact density |
| **Notion** | Sidebar navigation, clean content area, breadcrumbs |
| **Linear** | Table/list views, keyboard shortcuts, command palette, issue detail panel |
| **Figma Desktop** | Custom title bar, panel layout, toolbar patterns |
| **Outlook/Thunderbird** | Three-pane email layout (applicable to Replies page) |
| **TablePlus/Postico** | Data table patterns, toolbar, sidebar |
| **Obsidian** | Sidebar, split panes, command palette, status bar |
| **Docker Desktop** | Container/job list with status, logs panel, real-time updates |
| **GitHub Desktop** | Step-by-step progress during push/pull/clone operations |
| **Transmission/qBittorrent** | Download queue with per-item status, progress, speed, actions |

---

## Appendix: Files to Modify

| File | Changes |
|------|---------|
| `electron/main.ts` | Add `titleBarStyle`, window min dimensions |
| `electron/menu.ts` | Add keyboard shortcut accelerators for new shortcuts |
| `electron/queue.ts` | Add `startedAt` field to job tracking, retain recent completed jobs for Pipeline history |
| `electron/ipc/queue.ipc.ts` | Forward activity step events, add job history retrieval handler |
| `electron/ipc/scrape.ipc.ts` | Emit structured `ActivityStep` events alongside raw log forwarding |
| `electron/ipc/lead.ipc.ts` | Emit `ActivityStep` events for refresh, check-replies, and other operations |
| `electron/preload.ts` | Expose new `onActivityStep` / `offActivityStep` IPC methods |
| `src/backend/logger.ts` | Add activity step emitter alongside existing log forwarder |
| `src/shared/ipc-channels.ts` | Add `SCRAPE_ACTIVITY` channel constant |
| `src/renderer/env.d.ts` | Add `ActivityStep` interface, update `QueueItemStatus` with `startedAt` |
| `src/renderer/App.tsx` | Replace header nav with sidebar component, add layout structure, add Pipeline route |
| `src/renderer/App.css` | Complete overhaul — sidebar, layout grid, panels, density, variables, activity feed styles, pipeline page styles |
| `src/renderer/pages/ComposePage.tsx` | Replace raw log panel with Activity Feed component, move sender config |
| `src/renderer/pages/DraftsPage.tsx` | Master-detail split, list view, toolbar |
| `src/renderer/pages/TrackingPage.tsx` | Table view, toolbar, panel-based follow-up composer |
| `src/renderer/pages/RepliesPage.tsx` | Three-pane layout, inline reply composer |
| `src/renderer/pages/ClosedPage.tsx` | Table view, toolbar |
| `src/renderer/index.html` | Body overflow hidden |
| `package.json` | Add `lucide-react` dependency |

**New files to create:**
- `src/renderer/components/Sidebar.tsx`
- `src/renderer/components/StatusBar.tsx`
- `src/renderer/components/Toolbar.tsx`
- `src/renderer/components/SplitPane.tsx`
- `src/renderer/components/CommandPalette.tsx`
- `src/renderer/components/ActivityFeed.tsx` — reusable step-list component for Compose page and Pipeline job detail
- `src/renderer/components/BottomPanel.tsx` — tabbed bottom panel with Logs, Queue, and Output tabs
- `src/renderer/components/ContextMenu.tsx` (if not using native menus)
- `src/renderer/pages/PipelinePage.tsx` — centralized job/queue dashboard
- `src/renderer/pages/SettingsPage.tsx`
