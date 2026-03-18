import { useState, useEffect, useRef, useCallback, Fragment } from "react";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Circle,
  MinusCircle,
  Search,
  RefreshCw,
  MessageSquare,
  Send,
  RotateCcw,
  Eye,
  ChevronDown,
  ChevronRight,
  X,
  AlertTriangle,
} from "lucide-react";
import ActivityFeed from "../components/ActivityFeed";
import { useBottomPanel } from "../components/BottomPanel";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

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

function getJobTypeIcon(type: string) {
  switch (type) {
    case "scrape-profile":
    case "refresh-profile":
    case "refresh-both":
      return <Search size={13} />;
    case "check-replies":
      return <Eye size={13} />;
    case "send-initial":
    case "send-followup":
      return <Send size={13} />;
    case "send-reply":
      return <MessageSquare size={13} />;
    default:
      return <Circle size={13} />;
  }
}

function getJobTarget(job: QueueItemStatus): string {
  const p = job.payload;
  if (typeof p.leadName === "string" && p.leadName) return p.leadName;
  if (typeof p.url === "string" && p.url) return p.url;
  if (typeof p.linkedinUrl === "string" && p.linkedinUrl) return p.linkedinUrl;
  return "Unknown";
}

type StatusFilter = "all" | "active" | "queued" | "completed" | "failed" | "cancelled";
type TypeFilter =
  | "all"
  | "scrape-profile"
  | "refresh-profile"
  | "refresh-both"
  | "check-replies"
  | "send-initial"
  | "send-followup"
  | "send-reply";
type QueueFilter = "all" | "data" | "action";

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: QueueItemStatus["status"] }) {
  switch (status) {
    case "active":
      return (
        <span className="pipeline-status-icon pipeline-status-icon--active" aria-label="Active">
          <Loader2 size={14} />
        </span>
      );
    case "completed":
      return (
        <span className="pipeline-status-icon pipeline-status-icon--completed" aria-label="Completed">
          <CheckCircle2 size={14} />
        </span>
      );
    case "failed":
      return (
        <span className="pipeline-status-icon pipeline-status-icon--failed" aria-label="Failed">
          <XCircle size={14} />
        </span>
      );
    case "cancelled":
      return (
        <span className="pipeline-status-icon pipeline-status-icon--cancelled" aria-label="Cancelled">
          <MinusCircle size={14} />
        </span>
      );
    default:
      return (
        <span className="pipeline-status-icon pipeline-status-icon--queued" aria-label="Queued">
          <Circle size={10} />
        </span>
      );
  }
}

function LiveTimer({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(Date.now() - startedAt);
  useEffect(() => {
    const id = setInterval(() => setElapsed(Date.now() - startedAt), 500);
    return () => clearInterval(id);
  }, [startedAt]);
  return <>{formatTime(elapsed)}</>;
}

function WaitTimer({ createdAt }: { createdAt: number }) {
  const [elapsed, setElapsed] = useState(Date.now() - createdAt);
  useEffect(() => {
    const id = setInterval(() => setElapsed(Date.now() - createdAt), 500);
    return () => clearInterval(id);
  }, [createdAt]);
  return <>waiting {formatTime(elapsed)}</>;
}

function JobTimeCell({ job }: { job: QueueItemStatus }) {
  if (job.status === "active" && job.startedAt) {
    return <LiveTimer startedAt={job.startedAt} />;
  }
  if ((job.status === "completed" || job.status === "failed") && job.startedAt && job.completedAt) {
    return <>{formatTime(job.completedAt - job.startedAt)}</>;
  }
  if (job.status === "queued") {
    return <WaitTimer createdAt={job.createdAt} />;
  }
  return <>—</>;
}

// ─── Job Detail (expanded row) ───────────────────────────────────────────────

interface JobDetailProps {
  job: QueueItemStatus;
  steps: ActivityStep[];
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
}

function JobDetail({ job, steps, onCancel, onRetry }: JobDetailProps) {
  const { openPanel } = useBottomPanel();
  const waitMs = job.startedAt ? job.startedAt - job.createdAt : null;
  const elapsedMs =
    job.startedAt && job.completedAt
      ? job.completedAt - job.startedAt
      : job.startedAt
      ? Date.now() - job.startedAt
      : null;

  return (
    <div className="pipeline-detail">
      <div className="pipeline-detail__meta">
        <div className="pipeline-detail__meta-row">
          <span className="pipeline-detail__meta-label">Job ID</span>
          <span className="pipeline-detail__meta-value pipeline-detail__meta-value--mono">{job.id}</span>
        </div>
        <div className="pipeline-detail__meta-row">
          <span className="pipeline-detail__meta-label">Queue</span>
          <span className="pipeline-detail__meta-value">{job.queue === "data" ? "Data Queue" : "Action Queue"}</span>
        </div>
        <div className="pipeline-detail__meta-row">
          <span className="pipeline-detail__meta-label">Created</span>
          <span className="pipeline-detail__meta-value">{formatTimestamp(job.createdAt)}</span>
        </div>
        {job.startedAt && (
          <div className="pipeline-detail__meta-row">
            <span className="pipeline-detail__meta-label">Started</span>
            <span className="pipeline-detail__meta-value">
              {formatTimestamp(job.startedAt)}
              {waitMs != null && (
                <span className="pipeline-detail__meta-secondary"> (waited {formatTime(waitMs)})</span>
              )}
            </span>
          </div>
        )}
        {elapsedMs != null && (
          <div className="pipeline-detail__meta-row">
            <span className="pipeline-detail__meta-label">
              {job.status === "active" ? "Elapsed" : "Duration"}
            </span>
            <span className="pipeline-detail__meta-value">
              {job.status === "active" && job.startedAt ? (
                <LiveTimer startedAt={job.startedAt} />
              ) : (
                formatTime(elapsedMs)
              )}
            </span>
          </div>
        )}
        {job.error && (
          <div className="pipeline-detail__meta-row pipeline-detail__meta-row--error">
            <span className="pipeline-detail__meta-label">Error</span>
            <span className="pipeline-detail__meta-value pipeline-detail__meta-value--error">{job.error}</span>
          </div>
        )}
      </div>

      {steps.length > 0 && (
        <div className="pipeline-detail__activity">
          <ActivityFeed steps={steps} onViewLogs={() => openPanel("logs")} />
        </div>
      )}

      <div className="pipeline-detail__actions">
        {(job.status === "queued" || job.status === "active") && (
          <button
            className="pipeline-btn pipeline-btn--danger"
            onClick={() => onCancel(job.id)}
            disabled={job.status === "active"}
          >
            <X size={13} /> Cancel Job
          </button>
        )}
        {job.status === "failed" && (
          <button className="pipeline-btn pipeline-btn--primary" onClick={() => onRetry(job.id)}>
            <RotateCcw size={13} /> Retry Job
          </button>
        )}
        <button
          className="pipeline-btn pipeline-btn--ghost"
          onClick={() => window.api.openLogsFolder()}
        >
          View Raw Logs
        </button>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function PipelinePage() {
  const itemsRef = useRef<Map<string, QueueItemStatus>>(new Map());
  const [jobs, setJobs] = useState<QueueItemStatus[]>([]);
  const [jobSteps, setJobSteps] = useState<Map<string, ActivityStep[]>>(new Map());
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [clearedCompleted, setClearedCompleted] = useState<Set<string>>(new Set());

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [queueFilter, setQueueFilter] = useState<QueueFilter>("all");

  const progressHandlerRef = useRef<QueueProgressHandler | null>(null);
  const drainedHandlerRef = useRef<QueueDrainedHandler | null>(null);
  const activityHandlerRef = useRef<ActivityStepHandler | null>(null);

  const syncJobs = useCallback(() => {
    setJobs([...itemsRef.current.values()]);
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

    const ah = window.api.onActivityStep((step) => {
      if (!step.jobId) return;
      setJobSteps((prev) => {
        const next = new Map(prev);
        const existing = next.get(step.jobId!) ?? [];
        const idx = existing.findIndex((s) => s.stepId === step.stepId);
        if (idx >= 0) {
          const updated = [...existing];
          updated[idx] = step;
          next.set(step.jobId!, updated);
        } else {
          next.set(step.jobId!, [...existing, step]);
        }
        return next;
      });
    });
    activityHandlerRef.current = ah;

    return () => {
      if (progressHandlerRef.current) {
        window.api.queue.removeProgressListener(progressHandlerRef.current);
      }
      if (drainedHandlerRef.current) {
        window.api.queue.removeDrainedListener(drainedHandlerRef.current);
      }
      if (activityHandlerRef.current) {
        window.api.offActivityStep(activityHandlerRef.current);
      }
    };
  }, [syncJobs]);

  const handleCancel = useCallback(async (jobId: string) => {
    await window.api.queue.cancel(jobId);
  }, []);

  const handleRetry = useCallback(async (jobId: string) => {
    await window.api.queue.retry(jobId);
  }, []);

  const handleCancelAll = useCallback(async () => {
    const hasQueued = jobs.some((j) => j.status === "queued");
    if (!hasQueued) return;
    const confirmed = await window.api.showConfirmDialog(
      "Cancel All Jobs",
      "Cancel all queued jobs?"
    );
    if (confirmed) await window.api.queue.cancelAll();
  }, [jobs]);

  const handleClearCompleted = useCallback(() => {
    setClearedCompleted((prev) => {
      const next = new Set(prev);
      for (const job of jobs) {
        if (job.status === "completed") next.add(job.id);
      }
      return next;
    });
  }, [jobs]);

  const handleContextMenu = useCallback(async (e: React.MouseEvent, job: QueueItemStatus) => {
    e.preventDefault();
    e.stopPropagation();
    const canCancel = job.status === "queued";
    const canRetry = job.status === "failed";

    const action = await window.api.showContextMenu([
      { id: 'cancel', label: 'Cancel Job', enabled: canCancel },
      { id: 'retry', label: 'Retry Job', enabled: canRetry },
      { id: 'sep1', label: '', type: 'separator' },
      { id: 'view-logs', label: 'View Logs', enabled: true },
    ]);

    if (!action) return;
    switch (action) {
      case 'cancel':
        await handleCancel(job.id);
        break;
      case 'retry':
        await handleRetry(job.id);
        break;
      case 'view-logs':
        window.api.openLogsFolder();
        break;
    }
  }, [handleCancel, handleRetry]);

  // Counts computed from all items (before local filter)
  const counts = {
    active: jobs.filter((j) => j.status === "active").length,
    queued: jobs.filter((j) => j.status === "queued").length,
    completed: jobs.filter((j) => j.status === "completed").length,
    failed: jobs.filter((j) => j.status === "failed").length,
    cancelled: jobs.filter((j) => j.status === "cancelled").length,
  };

  const filteredJobs = jobs.filter((job) => {
    if (clearedCompleted.has(job.id)) return false;
    if (statusFilter !== "all" && job.status !== statusFilter) return false;
    if (typeFilter !== "all" && job.type !== typeFilter) return false;
    if (queueFilter !== "all" && job.queue !== queueFilter) return false;
    return true;
  });

  // Sort: active first, then queued, then by createdAt descending
  const sortedJobs = [...filteredJobs].sort((a, b) => {
    const order: Record<string, number> = { active: 0, queued: 1, failed: 2, completed: 3, cancelled: 4 };
    const oa = order[a.status] ?? 5;
    const ob = order[b.status] ?? 5;
    if (oa !== ob) return oa - ob;
    return b.createdAt - a.createdAt;
  });

  return (
    <div className="pipeline-page">
      <div className="pipeline-header">
        <h1 className="pipeline-header__title">Pipeline</h1>
        <button
          className="pipeline-btn pipeline-btn--ghost"
          onClick={() => {
            window.api.queue.getStatus().then((s) => {
              itemsRef.current.clear();
              for (const item of [...s.dataQueue, ...s.actionQueue]) {
                itemsRef.current.set(item.id, item);
              }
              syncJobs();
            }).catch(() => {});
          }}
        >
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <div className="pipeline-summary">
        <div
          className={`pipeline-summary__card pipeline-summary__card--active${statusFilter === "active" ? " pipeline-summary__card--selected" : ""}`}
          onClick={() => setStatusFilter((f) => f === "active" ? "all" : "active")}
        >
          <span className="pipeline-summary__count">{counts.active}</span>
          <span className="pipeline-summary__label">Active</span>
          {counts.active > 0 && <span className="pipeline-summary__pulse" aria-hidden="true" />}
        </div>
        <div
          className={`pipeline-summary__card pipeline-summary__card--queued${statusFilter === "queued" ? " pipeline-summary__card--selected" : ""}`}
          onClick={() => setStatusFilter((f) => f === "queued" ? "all" : "queued")}
        >
          <span className="pipeline-summary__count">{counts.queued}</span>
          <span className="pipeline-summary__label">Queued</span>
        </div>
        <div
          className={`pipeline-summary__card pipeline-summary__card--completed${statusFilter === "completed" ? " pipeline-summary__card--selected" : ""}`}
          onClick={() => setStatusFilter((f) => f === "completed" ? "all" : "completed")}
        >
          <span className="pipeline-summary__count">{counts.completed}</span>
          <span className="pipeline-summary__label">Completed</span>
        </div>
        <div
          className={`pipeline-summary__card pipeline-summary__card--failed${statusFilter === "failed" ? " pipeline-summary__card--selected" : ""}`}
          onClick={() => setStatusFilter((f) => f === "failed" ? "all" : "failed")}
        >
          <span className="pipeline-summary__count">{counts.failed}</span>
          <span className="pipeline-summary__label">Failed</span>
          {counts.failed > 0 && <AlertTriangle size={12} className="pipeline-summary__alert" />}
        </div>
        <div
          className={`pipeline-summary__card pipeline-summary__card--cancelled${statusFilter === "cancelled" ? " pipeline-summary__card--selected" : ""}`}
          onClick={() => setStatusFilter((f) => f === "cancelled" ? "all" : "cancelled")}
        >
          <span className="pipeline-summary__count">{counts.cancelled}</span>
          <span className="pipeline-summary__label">Cancelled</span>
        </div>
      </div>

      {/* Filter & Control Bar */}
      <div className="pipeline-filters">
        <div className="pipeline-filters__selects">
          <select
            className="pipeline-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            aria-label="Filter by status"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="queued">Queued</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select
            className="pipeline-select"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
            aria-label="Filter by type"
          >
            <option value="all">All Types</option>
            <option value="scrape-profile">Scrape Profile</option>
            <option value="refresh-profile">Refresh Profile</option>
            <option value="refresh-both">Refresh Both</option>
            <option value="check-replies">Check Replies</option>
            <option value="send-initial">Send Initial</option>
            <option value="send-followup">Send Follow-up</option>
            <option value="send-reply">Send Reply</option>
          </select>
          <select
            className="pipeline-select"
            value={queueFilter}
            onChange={(e) => setQueueFilter(e.target.value as QueueFilter)}
            aria-label="Filter by queue"
          >
            <option value="all">All Queues</option>
            <option value="data">Data Queue</option>
            <option value="action">Action Queue</option>
          </select>
        </div>
        <div className="pipeline-filters__actions">
          <button
            className="pipeline-btn pipeline-btn--ghost"
            onClick={handleClearCompleted}
            disabled={counts.completed === 0}
          >
            Clear Completed
          </button>
          <button
            className="pipeline-btn pipeline-btn--danger"
            onClick={handleCancelAll}
            disabled={counts.queued === 0}
          >
            Cancel All
          </button>
        </div>
      </div>

      {/* Job Table */}
      <div className="pipeline-table-wrapper">
        {sortedJobs.length === 0 ? (
          <div className="pipeline-empty">
            <Circle size={32} className="pipeline-empty__icon" />
            <p className="pipeline-empty__text">No jobs to display</p>
            <p className="pipeline-empty__sub">Jobs will appear here when the queue is active.</p>
          </div>
        ) : (
          <table className="pipeline-table">
            <thead className="pipeline-table__head">
              <tr>
                <th className="pipeline-table__th pipeline-table__th--status" />
                <th className="pipeline-table__th pipeline-table__th--type">Type</th>
                <th className="pipeline-table__th pipeline-table__th--target">Target</th>
                <th className="pipeline-table__th pipeline-table__th--queue">Queue</th>
                <th className="pipeline-table__th pipeline-table__th--statuslabel">Status</th>
                <th className="pipeline-table__th pipeline-table__th--time">Time</th>
                <th className="pipeline-table__th pipeline-table__th--actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedJobs.map((job) => {
                const isExpanded = expandedJobId === job.id;
                const steps = jobSteps.get(job.id) ?? [];
                const rowClass = [
                  "pipeline-table__row",
                  job.status === "active" ? "pipeline-table__row--active" : "",
                  job.status === "failed" ? "pipeline-table__row--failed" : "",
                  job.status === "completed" ? "pipeline-table__row--completed" : "",
                  isExpanded ? "pipeline-table__row--expanded" : "",
                ]
                  .filter(Boolean)
                  .join(" ");

                return (
                  <Fragment key={job.id}>
                    <tr
                      className={rowClass}
                      onClick={() => setExpandedJobId((id) => (id === job.id ? null : job.id))}
                      onContextMenu={(e) => handleContextMenu(e, job)}
                      style={{ cursor: "pointer" }}
                    >
                      <td className="pipeline-table__td pipeline-table__td--status">
                        <StatusIcon status={job.status} />
                      </td>
                      <td className="pipeline-table__td pipeline-table__td--type">
                        <span className="pipeline-type-cell">
                          <span className="pipeline-type-cell__icon">{getJobTypeIcon(job.type)}</span>
                          <span className="pipeline-type-cell__label">{getJobTypeLabel(job.type)}</span>
                        </span>
                      </td>
                      <td className="pipeline-table__td pipeline-table__td--target">
                        <span className="pipeline-target" title={getJobTarget(job)}>
                          {getJobTarget(job)}
                        </span>
                      </td>
                      <td className="pipeline-table__td pipeline-table__td--queue">
                        <span className={`pipeline-queue-badge pipeline-queue-badge--${job.queue}`}>
                          {job.queue === "data" ? "Data" : "Action"}
                        </span>
                      </td>
                      <td className="pipeline-table__td pipeline-table__td--statuslabel">
                        <span className={`pipeline-status-label pipeline-status-label--${job.status}`}>
                          {job.status.charAt(0).toUpperCase() + job.status.slice(1)}
                        </span>
                      </td>
                      <td className="pipeline-table__td pipeline-table__td--time">
                        <span className="pipeline-time">
                          <JobTimeCell job={job} />
                        </span>
                      </td>
                      <td
                        className="pipeline-table__td pipeline-table__td--actions"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="pipeline-row-actions">
                          {job.status === "queued" && (
                            <button
                              className="pipeline-action-btn pipeline-action-btn--cancel"
                              onClick={() => handleCancel(job.id)}
                              title="Cancel job"
                            >
                              <X size={12} /> Cancel
                            </button>
                          )}
                          {job.status === "failed" && (
                            <button
                              className="pipeline-action-btn pipeline-action-btn--retry"
                              onClick={() => handleRetry(job.id)}
                              title="Retry job"
                            >
                              <RotateCcw size={12} /> Retry
                            </button>
                          )}
                          <span className="pipeline-expand-indicator">
                            {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          </span>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="pipeline-table__detail-row">
                        <td colSpan={7} className="pipeline-table__detail-cell">
                          <JobDetail
                            job={job}
                            steps={steps}
                            onCancel={handleCancel}
                            onRetry={handleRetry}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
