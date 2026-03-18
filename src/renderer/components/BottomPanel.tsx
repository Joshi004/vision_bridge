import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { ChevronDown, ChevronUp, Loader2, X } from "lucide-react";

// ─── Context ─────────────────────────────────────────────────────────────────

type BottomPanelTab = "logs" | "queue" | "output";

interface BottomPanelContextValue {
  openPanel: (tab?: BottomPanelTab) => void;
}

export const BottomPanelContext = createContext<BottomPanelContextValue>({
  openPanel: () => {},
});

export function useBottomPanel() {
  return useContext(BottomPanelContext);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STORAGE_KEY_HEIGHT = "bottom_panel_height";
const DEFAULT_HEIGHT = 250;
const MIN_HEIGHT = 120;
const LOG_BUFFER_MAX = 2000;
const AUTO_SCROLL_THRESHOLD = 60;

function getJobTypeLabel(type: string): string {
  const map: Record<string, string> = {
    "scrape-profile": "Scrape Profile",
    "refresh-profile": "Refresh Profile",
    "refresh-both": "Refresh Both",
    "check-replies": "Check Replies",
    "send-initial": "Send Initial",
    "send-followup": "Send Follow-up",
    "send-reply": "Send Reply",
  };
  return map[type] ?? type;
}

function getJobTarget(item: QueueItemStatus): string {
  const p = item.payload;
  if (typeof p.url === "string") return p.url;
  if (typeof p.name === "string") return p.name;
  if (typeof p.leadId === "number") return `Lead #${p.leadId}`;
  return item.type;
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

// ─── LogsPanel ───────────────────────────────────────────────────────────────

function LogsPanel() {
  const [entries, setEntries] = useState<ScrapeLogEntry[]>([]);
  const [levelFilter, setLevelFilter] = useState<string>("ALL");
  const [componentFilter, setComponentFilter] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);

  useEffect(() => {
    const handler = window.api.onScrapeLog((entry) => {
      setEntries((prev) => {
        const next = [...prev, entry];
        return next.length > LOG_BUFFER_MAX ? next.slice(next.length - LOG_BUFFER_MAX) : next;
      });
    });
    return () => {
      window.api.offScrapeLog(handler);
    };
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || userScrolledUp.current) return;
    el.scrollTop = el.scrollHeight;
  }, [entries]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    userScrolledUp.current =
      el.scrollTop + el.clientHeight < el.scrollHeight - AUTO_SCROLL_THRESHOLD;
  }

  const filtered = entries.filter((e) => {
    if (levelFilter !== "ALL" && e.level !== levelFilter) return false;
    if (componentFilter && !e.component.toLowerCase().includes(componentFilter.toLowerCase()))
      return false;
    return true;
  });

  return (
    <div className="bottom-panel__logs">
      <div className="bottom-panel__filters">
        <select
          className="bottom-panel__filter-select"
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value)}
          aria-label="Filter by log level"
        >
          <option value="ALL">All levels</option>
          <option value="INFO">INFO</option>
          <option value="DEBUG">DEBUG</option>
          <option value="ERROR">ERROR</option>
        </select>
        <input
          className="bottom-panel__filter-input"
          type="text"
          placeholder="Filter by component…"
          value={componentFilter}
          onChange={(e) => setComponentFilter(e.target.value)}
          aria-label="Filter by component"
        />
        {entries.length > 0 && (
          <button
            className="bottom-panel__filter-clear"
            onClick={() => setEntries([])}
            title="Clear log buffer"
            type="button"
          >
            Clear
          </button>
        )}
        <span className="bottom-panel__log-count">
          {filtered.length}{entries.length !== filtered.length ? ` / ${entries.length}` : ""} entries
        </span>
      </div>

      <div
        className="diag-log-scroll bottom-panel__log-scroll"
        ref={scrollRef}
        onScroll={handleScroll}
      >
        {filtered.length === 0 ? (
          <div className="bottom-panel__empty">
            {entries.length === 0
              ? "No log entries yet. Logs appear here when a job runs."
              : "No entries match the current filters."}
          </div>
        ) : (
          filtered.map((entry, i) => (
            <div
              key={i}
              className={`diag-log-line diag-log-${entry.level.toLowerCase()}`}
            >
              <span className="diag-log-time">{entry.timestamp}</span>
              <span className="diag-log-level">{entry.level}</span>
              <span className="diag-log-component">[{entry.component}]</span>
              <span className="diag-log-msg">{entry.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── QueuePanel ──────────────────────────────────────────────────────────────

function QueuePanel() {
  const [jobs, setJobs] = useState<QueueItemStatus[]>([]);
  const itemsRef = useRef<Map<string, QueueItemStatus>>(new Map());
  const progressHandlerRef = useRef<QueueProgressHandler | null>(null);
  const drainedHandlerRef = useRef<QueueDrainedHandler | null>(null);

  const syncJobs = useCallback(() => {
    const all = [...itemsRef.current.values()];
    const visible = all.filter(
      (i) => i.status === "active" || i.status === "queued"
    );
    visible.sort((a, b) => {
      if (a.status === "active" && b.status !== "active") return -1;
      if (b.status === "active" && a.status !== "active") return 1;
      return a.createdAt - b.createdAt;
    });
    setJobs(visible);
  }, []);

  useEffect(() => {
    window.api.queue.getStatus().then((s) => {
      for (const item of [...s.dataQueue, ...s.actionQueue]) {
        itemsRef.current.set(item.id, item);
      }
      syncJobs();
    }).catch(() => {});

    const ph = window.api.queue.onProgress((item) => {
      itemsRef.current.set(item.id, item);
      syncJobs();
    });
    progressHandlerRef.current = ph;

    const dh = window.api.queue.onDrained(() => {
      syncJobs();
    });
    drainedHandlerRef.current = dh;

    return () => {
      if (progressHandlerRef.current) {
        window.api.queue.removeProgressListener(progressHandlerRef.current);
      }
      if (drainedHandlerRef.current) {
        window.api.queue.removeDrainedListener(drainedHandlerRef.current);
      }
    };
  }, [syncJobs]);

  const handleCancel = useCallback(async (jobId: string) => {
    await window.api.queue.cancel(jobId);
  }, []);

  if (jobs.length === 0) {
    return (
      <div className="bottom-panel__queue">
        <div className="bottom-panel__empty">No active or queued jobs.</div>
      </div>
    );
  }

  return (
    <div className="bottom-panel__queue">
      <div className="bottom-panel__queue-list">
        {jobs.map((job) => {
          const isActive = job.status === "active";
          const elapsed = job.startedAt ? Date.now() - job.startedAt : null;
          return (
            <div
              key={job.id}
              className={`bottom-panel__queue-row${isActive ? " bottom-panel__queue-row--active" : ""}`}
            >
              <span className="bottom-panel__queue-icon" aria-label={job.status}>
                {isActive ? (
                  <Loader2 size={13} className="bottom-panel__spin" />
                ) : (
                  <span className="bottom-panel__queue-dot" />
                )}
              </span>
              <span className="bottom-panel__queue-type">
                {getJobTypeLabel(job.type)}
              </span>
              <span className="bottom-panel__queue-target" title={getJobTarget(job)}>
                {getJobTarget(job)}
              </span>
              {elapsed !== null && (
                <span className="bottom-panel__queue-elapsed">
                  {formatElapsed(elapsed)}
                </span>
              )}
              <button
                className="bottom-panel__queue-cancel"
                onClick={() => handleCancel(job.id)}
                title="Cancel job"
                type="button"
                aria-label="Cancel job"
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── OutputPanel ─────────────────────────────────────────────────────────────

function OutputPanel() {
  return (
    <div className="bottom-panel__output">
      <div className="bottom-panel__empty">No output yet.</div>
    </div>
  );
}

// ─── BottomPanel ─────────────────────────────────────────────────────────────

interface BottomPanelProps {
  isOpen: boolean;
  activeTab: BottomPanelTab;
  onToggle: () => void;
  onTabChange: (tab: BottomPanelTab) => void;
}

const TABS: { id: BottomPanelTab; label: string }[] = [
  { id: "logs", label: "Logs" },
  { id: "queue", label: "Queue" },
  { id: "output", label: "Output" },
];

export default function BottomPanel({
  isOpen,
  activeTab,
  onToggle,
  onTabChange,
}: BottomPanelProps) {
  const [panelHeight, setPanelHeight] = useState<number>(() => {
    const stored = localStorage.getItem(STORAGE_KEY_HEIGHT);
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (!isNaN(parsed) && parsed >= MIN_HEIGHT) return parsed;
    }
    return DEFAULT_HEIGHT;
  });

  const isDragging = useRef(false);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);

  const handleDragMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      dragStartY.current = e.clientY;
      dragStartHeight.current = panelHeight;

      function onMouseMove(ev: MouseEvent) {
        if (!isDragging.current) return;
        const delta = dragStartY.current - ev.clientY;
        const maxHeight = Math.floor(window.innerHeight * 0.5);
        const newHeight = Math.min(
          Math.max(dragStartHeight.current + delta, MIN_HEIGHT),
          maxHeight
        );
        setPanelHeight(newHeight);
      }

      function onMouseUp(upEv: MouseEvent) {
        isDragging.current = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        const delta = dragStartY.current - upEv.clientY;
        const maxHeight = Math.floor(window.innerHeight * 0.5);
        const finalHeight = Math.min(
          Math.max(dragStartHeight.current + delta, MIN_HEIGHT),
          maxHeight
        );
        localStorage.setItem(STORAGE_KEY_HEIGHT, String(finalHeight));
      }

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [panelHeight]
  );

  // Persist height when it stabilizes
  useEffect(() => {
    if (!isDragging.current) {
      localStorage.setItem(STORAGE_KEY_HEIGHT, String(panelHeight));
    }
  }, [panelHeight]);

  function handleTabClick(tab: BottomPanelTab) {
    if (isOpen && activeTab === tab) {
      onToggle();
    } else {
      onTabChange(tab);
    }
  }

  return (
    <div
      className={`bottom-panel${isOpen ? "" : " bottom-panel--collapsed"}`}
      style={isOpen ? { height: panelHeight } : undefined}
    >
      {isOpen && (
        <div
          className="bottom-panel__drag-handle"
          onMouseDown={handleDragMouseDown}
          title="Drag to resize"
          role="separator"
          aria-orientation="horizontal"
        >
          <span className="bottom-panel__drag-grip" />
        </div>
      )}

      <div className="bottom-panel__header">
        <div className="bottom-panel__tabs" role="tablist">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isOpen && activeTab === tab.id}
              className={`bottom-panel__tab${isOpen && activeTab === tab.id ? " bottom-panel__tab--active" : ""}`}
              onClick={() => handleTabClick(tab.id)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>

        <button
          className="bottom-panel__collapse-btn"
          onClick={onToggle}
          title={isOpen ? "Collapse panel" : "Expand panel"}
          type="button"
          aria-label={isOpen ? "Collapse panel" : "Expand panel"}
        >
          {isOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </div>

      {isOpen && (
        <div className="bottom-panel__content" role="tabpanel">
          {activeTab === "logs" && <LogsPanel />}
          {activeTab === "queue" && <QueuePanel />}
          {activeTab === "output" && <OutputPanel />}
        </div>
      )}
    </div>
  );
}
