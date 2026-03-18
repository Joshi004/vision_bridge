import { useState, useEffect, useCallback, useRef, Fragment } from "react";
import { AlertTriangle, RefreshCw, X, ChevronRight, ChevronUp, ChevronDown } from "lucide-react";
import Toolbar, { ToolbarDivider, ToolbarSpacer } from "../components/Toolbar";
import SplitPane from "../components/SplitPane";
import { useListKeyboardNav } from "../hooks/useListKeyboardNav";
import { useNotification } from "../hooks/useNotifications";

interface TrackingPageProps {
  onOverdueChange?: () => void;
}

interface CardQueueInfo {
  jobId: string;
  status: 'queued' | 'active' | 'failed';
  error?: string;
}

// ── Date / cadence helpers ───────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatFollowUpLabel(followUpNumber: number): string {
  return `Follow-Up ${followUpNumber}`;
}

function getCadenceStatus(lead: LeadWithProfile): {
  nextLabel: string;
  isOverdue: boolean;
  daysText: string;
  followUpNumber: number | null;
  overdueDays: number;
} {
  const now = new Date();
  const followUpNumber = lead.follow_up_count < lead.max_follow_ups
    ? lead.follow_up_count + 1
    : null;

  if (!lead.next_follow_up_at || followUpNumber === null) {
    return { nextLabel: "All follow-ups sent", isOverdue: false, daysText: "", followUpNumber: null, overdueDays: 0 };
  }

  const dueDate = new Date(lead.next_follow_up_at);
  const diffMs = dueDate.getTime() - now.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    const overdueDays = Math.abs(diffDays);
    return {
      nextLabel: `Follow-Up ${followUpNumber}`,
      isOverdue: true,
      daysText: `${overdueDays}d overdue`,
      followUpNumber,
      overdueDays,
    };
  }

  if (diffDays === 0) {
    return {
      nextLabel: `Follow-Up ${followUpNumber}`,
      isOverdue: false,
      daysText: "today",
      followUpNumber,
      overdueDays: 0,
    };
  }

  return {
    nextLabel: `Follow-Up ${followUpNumber}`,
    isOverdue: false,
    daysText: `in ${diffDays}d`,
    followUpNumber,
    overdueDays: 0,
  };
}

function isOverdue(lead: LeadWithProfile): boolean {
  if (!lead.next_follow_up_at || lead.follow_up_count >= lead.max_follow_ups) return false;
  return new Date(lead.next_follow_up_at) < new Date();
}

// ── Sorting helpers ──────────────────────────────────────────────────────────

type SortBy = "next_action_due" | "initial_sent_date" | "name";
type SortDir = "asc" | "desc";
type FilterBy = "all" | "overdue";

const PERSONA_LABELS: Record<string, string> = {
  c_level: "C-Level",
  management: "Management",
  top_engineer: "Top Engineer",
  mid_engineer: "Mid Engineer",
  junior_engineer: "Junior",
  recruiter: "Recruiter",
  procurement: "Procurement",
  other: "Other",
};

function sortLeads(leads: LeadWithProfile[], sortBy: SortBy, dir: SortDir): LeadWithProfile[] {
  const sorted = [...leads];
  const mult = dir === "asc" ? 1 : -1;
  if (sortBy === "next_action_due") {
    sorted.sort((a, b) => {
      if (!a.next_follow_up_at && !b.next_follow_up_at) return 0;
      if (!a.next_follow_up_at) return 1 * mult;
      if (!b.next_follow_up_at) return -1 * mult;
      return (new Date(a.next_follow_up_at).getTime() - new Date(b.next_follow_up_at).getTime()) * mult;
    });
  } else if (sortBy === "initial_sent_date") {
    sorted.sort((a, b) => {
      if (!a.initial_sent_at && !b.initial_sent_at) return 0;
      if (!a.initial_sent_at) return 1 * mult;
      if (!b.initial_sent_at) return -1 * mult;
      return (new Date(b.initial_sent_at).getTime() - new Date(a.initial_sent_at).getTime()) * mult;
    });
  } else {
    sorted.sort((a, b) => {
      const nameA = a.profile.name ?? "";
      const nameB = b.profile.name ?? "";
      return nameA.localeCompare(nameB) * mult;
    });
  }
  return sorted;
}

function filterLeads(
  leads: LeadWithProfile[],
  filterBy: FilterBy,
  dateFrom: string,
  dateTo: string,
): LeadWithProfile[] {
  let result = leads;

  if (filterBy === "overdue") {
    result = result.filter(isOverdue);
  }

  if (dateFrom) {
    const from = new Date(dateFrom);
    result = result.filter((l) => l.initial_sent_at && new Date(l.initial_sent_at) >= from);
  }

  if (dateTo) {
    const to = new Date(dateTo);
    to.setHours(23, 59, 59, 999);
    result = result.filter((l) => l.initial_sent_at && new Date(l.initial_sent_at) <= to);
  }

  return result;
}

// ── Main component ───────────────────────────────────────────────────────────

export default function TrackingPage({ onOverdueChange }: TrackingPageProps) {
  const [leads, setLeads] = useState<LeadWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Controls
  const [sortBy, setSortBy] = useState<SortBy>("next_action_due");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [filterBy, setFilterBy] = useState<FilterBy>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Per-row action states
  const [markingColdId, setMarkingColdId] = useState<number | null>(null);
  const [cardErrors, setCardErrors] = useState<Record<number, string>>({});
  const [checkingReplyId, setCheckingReplyId] = useState<number | null>(null);

  // Update All state
  const [checkAllRunning, setCheckAllRunning] = useState(false);
  const [checkAllResult, setCheckAllResult] = useState<{ checked: number; repliesFound: number; errors: number } | null>(null);
  const [checkAllProgress, setCheckAllProgress] = useState<{
    total: number; completed: number; repliesFound: number; errors: number;
  } | null>(null);

  // Follow-Up Composer
  const [composerLeadId, setComposerLeadId] = useState<number | null>(null);
  const [composerGenerating, setComposerGenerating] = useState(false);
  const [composerData, setComposerData] = useState<{
    followUpNumber: number;
    followUpType: string;
    generatedMessage: string;
    priorMessages: OutreachThreadMessage[];
  } | null>(null);
  const [composerEditedMessage, setComposerEditedMessage] = useState("");
  const [composerSending, setComposerSending] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);

  // Queue state for follow-up sends
  const [followUpQueueState, setFollowUpQueueState] = useState<Record<number, CardQueueInfo>>({});

  const { notify } = useNotification();
  const progressHandlerRef = useRef<ReturnType<typeof window.api.queue.onProgress> | null>(null);
  const checkAllProgressRef = useRef<{ total: number; completed: number; repliesFound: number; errors: number } | null>(null);
  const onOverdueChangeRef = useRef(onOverdueChange);

  // ── Helpers ──────────────────────────────────────────────────────────────

  const showNotification = useCallback((msg: string) => {
    notify(msg, "info");
  }, [notify]);

  function setCardError(id: number, msg: string) {
    setCardErrors((prev) => ({ ...prev, [id]: msg }));
  }

  function clearCardError(id: number) {
    setCardErrors((prev) => {
      const n = { ...prev };
      delete n[id];
      return n;
    });
  }

  function toggleSort(col: SortBy) {
    if (sortBy === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(col);
      setSortDir("asc");
    }
  }

  // ── Data fetching ─────────────────────────────────────────────────────────

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await window.api.getLeadsByStage("contacted");
      setLeads(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tracking data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  // Listen for global refresh shortcut
  useEffect(() => {
    const handler = () => fetchLeads();
    window.addEventListener("visionbridge:refresh", handler);
    return () => window.removeEventListener("visionbridge:refresh", handler);
  }, [fetchLeads]);

  useEffect(() => {
    onOverdueChangeRef.current = onOverdueChange;
  }, [onOverdueChange]);

  // Subscribe to queue progress events
  useEffect(() => {
    window.api.queue.getStatus().then((snapshot) => {
      const fuJobs = snapshot.actionQueue.filter(
        (item) =>
          item.type === 'send-followup' &&
          (item.status === 'queued' || item.status === 'active' || item.status === 'failed')
      );
      if (fuJobs.length > 0) {
        const state: Record<number, CardQueueInfo> = {};
        for (const job of fuJobs) {
          const leadId = job.payload.leadId as number | undefined;
          if (leadId !== undefined) {
            state[leadId] = {
              jobId: job.id,
              status: job.status as CardQueueInfo['status'],
              error: job.error,
            };
          }
        }
        setFollowUpQueueState(state);
      }

      const checkJobs = snapshot.dataQueue.filter(
        (item) =>
          item.type === 'check-replies' &&
          (item.status === 'queued' || item.status === 'active')
      );
      if (checkJobs.length > 0) {
        const progress = { total: checkJobs.length, completed: 0, repliesFound: 0, errors: 0 };
        checkAllProgressRef.current = progress;
        setCheckAllProgress(progress);
        setCheckAllRunning(true);
      }
    });

    const handler = window.api.queue.onProgress((item) => {
      if (item.type === 'send-followup') {
        const leadId = item.payload.leadId as number | undefined;
        if (leadId === undefined) return;

        if (item.status === 'completed') {
          setFollowUpQueueState((prev) => {
            const n = { ...prev };
            delete n[leadId];
            return n;
          });
          setComposerLeadId((prev) => {
            if (prev === leadId) {
              setComposerData(null);
              setComposerEditedMessage('');
              setComposerError(null);
              setComposerGenerating(false);
              setComposerSending(false);
              return null;
            }
            return prev;
          });
          fetchLeads().then(() => onOverdueChangeRef.current?.());
          showNotification('Follow-up sent successfully.');
        } else if (item.status === 'cancelled') {
          setFollowUpQueueState((prev) => {
            const n = { ...prev };
            delete n[leadId];
            return n;
          });
          setComposerLeadId((prev) => {
            if (prev === leadId) setComposerSending(false);
            return prev;
          });
        } else if (item.status === 'failed') {
          setFollowUpQueueState((prev) => ({
            ...prev,
            [leadId]: { jobId: item.id, status: 'failed', error: item.error },
          }));
          setComposerLeadId((prev) => {
            if (prev === leadId) {
              setComposerError(item.error ?? 'Failed to send follow-up.');
              setComposerSending(false);
            }
            return prev;
          });
        } else {
          setFollowUpQueueState((prev) => ({
            ...prev,
            [leadId]: { jobId: item.id, status: item.status as CardQueueInfo['status'] },
          }));
        }
      }

      if (item.type === 'check-replies') {
        if (item.status === 'completed' || item.status === 'failed' || item.status === 'cancelled') {
          const hasReply =
            item.status === 'completed' &&
            (item.result as Record<string, unknown> | undefined)?.hasReply === true;

          const prev = checkAllProgressRef.current;
          const next = prev
            ? {
                ...prev,
                completed: prev.completed + 1,
                repliesFound: prev.repliesFound + (hasReply ? 1 : 0),
                errors: prev.errors + (item.status === 'failed' ? 1 : 0),
              }
            : null;
          checkAllProgressRef.current = next;
          setCheckAllProgress(next ? { ...next } : null);

          if (next && next.completed >= next.total) {
            setCheckAllRunning(false);
            setCheckAllResult({
              checked: next.completed,
              repliesFound: next.repliesFound,
              errors: next.errors,
            });
            checkAllProgressRef.current = null;
            if (next.repliesFound > 0) {
              fetchLeads();
              onOverdueChangeRef.current?.();
            }
          }
        }
      }
    });

    progressHandlerRef.current = handler;
    return () => {
      if (progressHandlerRef.current) {
        window.api.queue.removeProgressListener(progressHandlerRef.current);
        progressHandlerRef.current = null;
      }
    };
  }, [fetchLeads, showNotification]);

  // ── Check for replies (single lead) ──────────────────────────────────────

  async function checkReply(id: number) {
    setCheckingReplyId(id);
    clearCardError(id);
    try {
      const result = await window.api.checkForReplies(id);
      if (!result.success) {
        setCardError(id, result.error);
        return;
      }
      if (result.hasReply) {
        setLeads((prev) => prev.filter((l) => l.id !== id));
        showNotification("Reply detected — moved to Replies");
        onOverdueChange?.();
      } else {
        showNotification("No new replies found.");
      }
    } catch (err) {
      setCardError(id, err instanceof Error ? err.message : "Failed to check for replies.");
    } finally {
      setCheckingReplyId(null);
    }
  }

  // ── Update All ────────────────────────────────────────────────────────────

  async function checkAllReplies() {
    setCheckAllRunning(true);
    setCheckAllResult(null);
    setCheckAllProgress(null);
    checkAllProgressRef.current = null;
    try {
      const result = await window.api.checkAllReplies();
      if ('queued' in result && result.queued) {
        const progress = { total: result.count, completed: 0, repliesFound: 0, errors: 0 };
        checkAllProgressRef.current = progress;
        setCheckAllProgress(progress);
      } else if ('success' in result && result.success === false) {
        showNotification(result.error || 'Update All failed.');
        setCheckAllRunning(false);
      }
    } catch (err) {
      showNotification(err instanceof Error ? err.message : 'Update All failed.');
      setCheckAllRunning(false);
    }
  }

  // ── Mark as Cold ──────────────────────────────────────────────────────────

  async function handleMarkCold(id: number, name: string) {
    const confirmed = await window.api.showConfirmDialog(
      "Mark as Cold",
      `Mark "${name}" as Cold? This will move them out of Tracking.`
    );
    if (confirmed) await markCold(id);
  }

  async function markCold(id: number) {
    setMarkingColdId(id);
    clearCardError(id);
    try {
      const result = await window.api.markCold(id);
      if (!result.success) {
        setCardError(id, result.error);
        return;
      }
      setLeads((prev) => prev.filter((l) => l.id !== id));
      showNotification("Lead marked as Cold.");
      onOverdueChange?.();
    } catch (err) {
      setCardError(id, err instanceof Error ? err.message : "Failed to mark as cold.");
    } finally {
      setMarkingColdId(null);
    }
  }

  // ── Follow-Up Composer ────────────────────────────────────────────────────

  async function openComposer(lead: LeadWithProfile) {
    setComposerLeadId(lead.id);
    setComposerData(null);
    setComposerEditedMessage("");
    setComposerError(null);
    setComposerGenerating(true);
    try {
      const result = await window.api.generateFollowUp(lead.id);
      if (!result.success) {
        setComposerError(result.error);
        setComposerGenerating(false);
        return;
      }
      setComposerData({
        followUpNumber: result.followUpNumber,
        followUpType: result.followUpType,
        generatedMessage: result.generatedMessage,
        priorMessages: result.priorMessages,
      });
      setComposerEditedMessage(result.generatedMessage);
    } catch (err) {
      setComposerError(err instanceof Error ? err.message : "Failed to generate follow-up.");
    } finally {
      setComposerGenerating(false);
    }
  }

  function closeComposer() {
    setComposerLeadId(null);
    setComposerData(null);
    setComposerEditedMessage("");
    setComposerError(null);
    setComposerGenerating(false);
    setComposerSending(false);
  }

  async function sendFollowUp() {
    if (!composerLeadId || !composerEditedMessage.trim()) return;
    setComposerSending(true);
    setComposerError(null);
    const leadId = composerLeadId;
    try {
      const result = await window.api.sendFollowUp(leadId, composerEditedMessage.trim());
      if ('queued' in result && result.queued) {
        setFollowUpQueueState((prev) => ({
          ...prev,
          [leadId]: { jobId: result.jobId, status: 'queued' },
        }));
      } else if ('success' in result && result.success === false) {
        const msg = result.needsLogin
          ? 'Your LinkedIn session has expired. Please log in again via the Compose page.'
          : result.error;
        setComposerError(msg);
      }
    } catch (err) {
      setComposerError(err instanceof Error ? err.message : 'Failed to send follow-up.');
    } finally {
      setComposerSending(false);
    }
  }

  // ── Context menu ─────────────────────────────────────────────────────────────

  async function handleContextMenu(e: React.MouseEvent, lead: LeadWithProfile) {
    e.preventDefault();
    const id = lead.id;
    const name = lead.profile.name ?? "LinkedIn Profile";
    const isBusyRow = markingColdId === id || checkingReplyId === id || checkAllRunning;
    const cadence = getCadenceStatus(lead);
    const fuQueueInfo = followUpQueueState[id];
    const hasFuInProgress = fuQueueInfo?.status === 'queued' || fuQueueInfo?.status === 'active';

    const action = await window.api.showContextMenu([
      { id: 'follow-up', label: cadence.followUpNumber !== null ? `Follow Up (FU ${cadence.followUpNumber})` : 'Follow Up (Exhausted)', enabled: !isBusyRow && !hasFuInProgress && cadence.followUpNumber !== null },
      { id: 'mark-cold', label: 'Mark Cold', enabled: !isBusyRow },
      { id: 'sep1', label: '', type: 'separator' },
      { id: 'refresh-profile', label: 'Check for Replies', enabled: !isBusyRow },
      { id: 'sep2', label: '', type: 'separator' },
      { id: 'open-linkedin', label: 'Open LinkedIn Profile', enabled: !!lead.profile.linkedin_url },
      { id: 'copy-url', label: 'Copy Profile URL', enabled: !!lead.profile.linkedin_url },
    ]);

    if (!action) return;
    switch (action) {
      case 'follow-up':
        openComposer(lead);
        break;
      case 'mark-cold':
        await handleMarkCold(id, name);
        break;
      case 'refresh-profile':
        await checkReply(id);
        break;
      case 'open-linkedin':
        window.open(lead.profile.linkedin_url, '_blank', 'noopener,noreferrer');
        break;
      case 'copy-url':
        await navigator.clipboard.writeText(lead.profile.linkedin_url);
        break;
    }
  }

  // ── Derived display list ──────────────────────────────────────────────────

  const composerLead = leads.find((l) => l.id === composerLeadId) ?? null;
  const displayedLeads = filterLeads(sortLeads(leads, sortBy, sortDir), filterBy, dateFrom, dateTo);

  // ── Keyboard navigation ───────────────────────────────────────────────────

  const { focusedIndex: kbFocusedIndex } = useListKeyboardNav({
    items: displayedLeads,
    selectedId: composerLeadId,
    onSelect: (id) => {
      const lead = leads.find((l) => l.id === id);
      if (lead) openComposer(lead);
    },
    getId: (l) => l.id,
  });

  const composerQueueInfo = composerLeadId != null ? followUpQueueState[composerLeadId] : undefined;
  const isComposerQueued = composerQueueInfo?.status === 'queued';
  const isComposerActivelySending = composerQueueInfo?.status === 'active' || composerSending;
  const isComposerFailed = composerQueueInfo?.status === 'failed';
  const isComposerInQueue = isComposerQueued || isComposerActivelySending;

  const overdueCount = leads.filter(isOverdue).length;

  // ── Sort header helper ────────────────────────────────────────────────────

  function SortArrow({ col }: { col: SortBy }) {
    if (sortBy !== col) return null;
    return (
      <span className="sort-arrow">
        {sortDir === "asc" ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
      </span>
    );
  }

  // ── Render: loading / error ───────────────────────────────────────────────

  if (loading) {
    return (
      <div className="tracking-layout">
        <div className="drafts-status-fill">
          <span className="bulk-spinner" aria-hidden="true" />
          Loading contacts…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="tracking-layout">
        <div className="drafts-status-fill drafts-status-fill--error">
          <p>{error}</p>
          <button className="btn btn-secondary" onClick={fetchLeads}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ── Table content ─────────────────────────────────────────────────────────

  const tableContent = (
    <div className="data-table-wrap">
      {displayedLeads.length === 0 ? (
        <div className="data-table__empty">
          {leads.length === 0
            ? "No contacted leads yet. Send initial messages from the Drafts page to start tracking follow-ups."
            : "No leads match the current filter."}
        </div>
      ) : (
        <table className="data-table">
          <colgroup>
            <col style={{ minWidth: 130 }} />
            <col style={{ minWidth: 130 }} />
            <col style={{ width: 90 }} />
            <col style={{ width: 100 }} />
            <col style={{ width: 90 }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 100 }} />
            <col style={{ width: 96 }} />
            <col style={{ width: 150 }} />
          </colgroup>
          <thead>
            <tr>
              <th
                className={`data-table th--sortable${sortBy === "name" ? " th--sorted" : ""}`}
                onClick={() => toggleSort("name")}
              >
                Name <SortArrow col="name" />
              </th>
              <th className="data-table">Role</th>
              <th className="data-table">Persona</th>
              <th
                className={`data-table th--sortable${sortBy === "initial_sent_date" ? " th--sorted" : ""}`}
                onClick={() => toggleSort("initial_sent_date")}
              >
                Initial Sent <SortArrow col="initial_sent_date" />
              </th>
              <th className="data-table">Follow-ups</th>
              <th
                className={`data-table th--sortable${sortBy === "next_action_due" ? " th--sorted" : ""}`}
                onClick={() => toggleSort("next_action_due")}
              >
                Next Due <SortArrow col="next_action_due" />
              </th>
              <th className="data-table">Last Sent</th>
              <th className="data-table">Status</th>
              <th className="data-table">Actions</th>
            </tr>
          </thead>
          <tbody>
            {displayedLeads.map((lead, listIdx) => {
              const id = lead.id;
              const name = lead.profile.name ?? "LinkedIn Profile";
              const cadence = getCadenceStatus(lead);
              const rowOverdue = cadence.isOverdue;
              const isMarkingCold = markingColdId === id;
              const isCheckingReply = checkingReplyId === id;
              const isBusy = isMarkingCold || isCheckingReply || checkAllRunning;
              const cardError = cardErrors[id];
              const fuQueueInfo = followUpQueueState[id];
              const hasFuQueued = fuQueueInfo?.status === 'queued';
              const hasFuActive = fuQueueInfo?.status === 'active';
              const lastSent = lead.last_contacted_at ?? lead.initial_sent_at;
              const isKeyboardFocused = listIdx === kbFocusedIndex;

              const statusBadge = cadence.followUpNumber === null
                ? <span className="data-table__badge data-table__badge--exhausted">Exhausted</span>
                : cadence.isOverdue
                ? <span className="data-table__badge data-table__badge--overdue"><AlertTriangle size={10} /> Overdue</span>
                : <span className="data-table__badge data-table__badge--ontrack">On Track</span>;

              return (
                <Fragment key={id}>
                  <tr
                    className={[rowOverdue ? "data-table tbody tr--overdue" : undefined, isKeyboardFocused ? "tr--keyboard-focused" : undefined].filter(Boolean).join(" ") || undefined}
                    onContextMenu={(e) => handleContextMenu(e, lead)}
                    onDoubleClick={() => { if (!isBusy && cadence.followUpNumber !== null) openComposer(lead); }}
                  >
                    <td>
                      <a
                        href={lead.profile.linkedin_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="data-table__name-link"
                        title={name}
                      >
                        {name}
                      </a>
                    </td>
                    <td title={[lead.role, lead.company].filter(Boolean).join(" · ") || "—"}>
                      {[lead.role, lead.company].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td>
                      {lead.persona && (
                        <span className={`meta-tag persona-${lead.persona} text-xs`}>
                          {PERSONA_LABELS[lead.persona] ?? lead.persona}
                        </span>
                      )}
                    </td>
                    <td>{formatDate(lead.initial_sent_at)}</td>
                    <td>{lead.follow_up_count}/{lead.max_follow_ups}</td>
                    <td
                      title={lead.next_follow_up_at ? formatDate(lead.next_follow_up_at) : "—"}
                      style={cadence.isOverdue ? { color: "var(--accent-danger)", fontWeight: 700 } : undefined}
                    >
                      {cadence.followUpNumber !== null ? (
                        <>
                          {formatDate(lead.next_follow_up_at)}
                          {cadence.isOverdue && (
                            <span className="text-xs" style={{ marginLeft: 4, color: "var(--accent-danger)" }}>
                              ({cadence.daysText})
                            </span>
                          )}
                        </>
                      ) : "—"}
                    </td>
                    <td>{formatDate(lastSent)}</td>
                    <td>{statusBadge}</td>
                    <td>
                      {hasFuQueued || hasFuActive ? (
                        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                          <span className="bulk-spinner-inline" aria-hidden="true" />
                          {hasFuQueued ? " Queued" : " Sending…"}
                        </span>
                      ) : (
                        <div className="data-table__actions">
                          <button
                            className="data-table__btn data-table__btn--primary"
                            onClick={() => openComposer(lead)}
                            disabled={isBusy || cadence.followUpNumber === null}
                            title={cadence.followUpNumber === null ? "All follow-ups sent" : `Send ${cadence.nextLabel}`}
                          >
                            FU {cadence.followUpNumber ?? lead.max_follow_ups}
                          </button>
                          <button
                            className="data-table__btn data-table__btn--danger"
                            onClick={() => handleMarkCold(id, name)}
                            disabled={isBusy}
                          >
                            Cold
                          </button>
                          <button
                            className="data-table__btn"
                            onClick={() => checkReply(id)}
                            disabled={isBusy}
                            title="Check for new replies"
                          >
                            {isCheckingReply ? (
                              <><span className="bulk-spinner-inline" aria-hidden="true" /> Checking…</>
                            ) : (
                              <RefreshCw size={11} />
                            )}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>

                  {/* Per-row error row */}
                  {cardError && (
                    <tr className="data-table__confirm-row">
                      <td colSpan={9} style={{ color: "var(--accent-danger-dark)", background: "var(--accent-danger-bg)" }}>
                        <div className="data-table__confirm-content">
                          <span className="data-table__confirm-text">{cardError}</span>
                          <button className="data-table__btn" onClick={() => clearCardError(id)}>Dismiss</button>
                        </div>
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
  );

  // ── Composer panel (right side) ───────────────────────────────────────────

  const composerPanel = composerLeadId !== null ? (
    <div className="tracking-composer">
      <div className="tracking-composer__header">
        <h3 className="tracking-composer__title">
          {composerGenerating
            ? "Generating…"
            : composerData
            ? `${formatFollowUpLabel(composerData.followUpNumber)} — ${composerLead?.profile.name ?? "Contact"}`
            : "Follow-Up Composer"}
        </h3>
        <button
          className="tracking-composer__close"
          onClick={closeComposer}
          aria-label="Close composer"
        >
          <X size={15} />
        </button>
      </div>

      {composerGenerating && (
        <div className="tracking-composer__generating">
          <span className="bulk-spinner" aria-hidden="true" />
          Generating follow-up…
        </div>
      )}

      {!composerGenerating && composerError && !composerData && (
        <div className="tracking-composer__error">
          <p>{composerError}</p>
          <button className="btn btn-secondary btn--sm" onClick={closeComposer}>
            Close
          </button>
        </div>
      )}

      {!composerGenerating && composerData && (
        <>
          <div className="tracking-composer__prior-section">
            <span className="tracking-composer__section-label">Previous messages</span>
            <div className="tracking-composer__prior-list">
              {composerData.priorMessages.map((msg) => {
                const isSelf = msg.sender === "self";
                return (
                  <div
                    key={msg.id}
                    className={`fu-prior-msg fu-prior-msg--${isSelf ? "self" : "them"}`}
                  >
                    <div className="fu-prior-msg__meta">
                      <span className="fu-prior-msg__sender">{isSelf ? "You" : "Them"}</span>
                      <span className="fu-prior-msg__type">
                        {msg.message_type === "initial"
                          ? "Initial"
                          : msg.message_type.startsWith("follow_up_")
                          ? `FU${msg.message_type.slice(-1)}`
                          : msg.message_type === "reply_received"
                          ? "Reply"
                          : msg.message_type}
                      </span>
                      {msg.sent_at && (
                        <span className="fu-prior-msg__date">{formatDate(msg.sent_at)}</span>
                      )}
                    </div>
                    <p className="fu-prior-msg__text">{msg.message}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="tracking-composer__body">
            <span className="tracking-composer__section-label">Suggested follow-up</span>
            <textarea
              className="draft-textarea tracking-composer__textarea"
              value={composerEditedMessage}
              onChange={(e) => setComposerEditedMessage(e.target.value)}
              disabled={composerSending}
              rows={8}
            />
          </div>

          {composerError && !isComposerFailed && (
            <div className="tracking-composer__send-error">{composerError}</div>
          )}

          {isComposerFailed && composerQueueInfo?.error && (
            <div className="tracking-composer__send-error">
              <span>{composerQueueInfo.error}</span>
              <button
                className="btn btn-send btn--sm"
                onClick={async () => {
                  if (composerQueueInfo?.jobId) {
                    setComposerError(null);
                    await window.api.queue.retry(composerQueueInfo.jobId);
                  }
                }}
              >
                Retry
              </button>
            </div>
          )}

          <div className="tracking-composer__actions">
            <button
              className="btn btn-secondary"
              onClick={async () => {
                if (isComposerQueued && composerQueueInfo?.jobId) {
                  await window.api.queue.cancel(composerQueueInfo.jobId);
                }
                closeComposer();
              }}
              disabled={isComposerActivelySending}
            >
              {isComposerQueued ? 'Cancel (Queued)' : 'Cancel'}
            </button>
            <button
              className="btn btn-send"
              onClick={sendFollowUp}
              disabled={isComposerInQueue || isComposerFailed || !composerEditedMessage.trim()}
            >
              {isComposerActivelySending ? (
                <><span className="bulk-spinner-inline" aria-hidden="true" /> Sending…</>
              ) : isComposerQueued ? (
                'Queued'
              ) : (
                <span className="btn-icon">
                  Send <ChevronRight size={14} />
                </span>
              )}
            </button>
          </div>
        </>
      )}
    </div>
  ) : null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="tracking-layout">
      {/* Toolbar */}
      <Toolbar>
        {/* Filter: All / Overdue */}
        <div className="toolbar__segment-group">
          <button
            className={`toolbar__segment-btn${filterBy === "all" ? " toolbar__segment-btn--active" : ""}`}
            onClick={() => setFilterBy("all")}
          >
            All ({leads.length})
          </button>
          <button
            className={`toolbar__segment-btn${filterBy === "overdue" ? " toolbar__segment-btn--active" : ""}`}
            onClick={() => setFilterBy("overdue")}
          >
            Overdue ({overdueCount})
          </button>
        </div>

        <ToolbarDivider />

        {/* Sort */}
        <select
          className="toolbar__select"
          value={sortBy}
          onChange={(e) => { setSortBy(e.target.value as SortBy); setSortDir("asc"); }}
          aria-label="Sort by"
        >
          <option value="next_action_due">Sort: Next Due</option>
          <option value="initial_sent_date">Sort: Initial Sent</option>
          <option value="name">Sort: Name</option>
        </select>

        <ToolbarDivider />

        {/* Date range */}
        <span className="toolbar__date-label">From</span>
        <input
          type="date"
          className="toolbar__date-input"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          aria-label="From date"
        />
        <span className="toolbar__date-label">To</span>
        <input
          type="date"
          className="toolbar__date-input"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          aria-label="To date"
        />

        <ToolbarSpacer />

        {/* Update All progress / result */}
        {checkAllRunning && (
          <span className="toolbar__count">
            <span className="bulk-spinner-inline" aria-hidden="true" />
            {checkAllProgress
              ? ` Checking ${checkAllProgress.completed}/${checkAllProgress.total}…`
              : ' Checking all…'}
          </span>
        )}
        {!checkAllRunning && checkAllResult && (
          <span className="toolbar__count">
            {checkAllResult.checked} checked · {checkAllResult.repliesFound} replies · {checkAllResult.errors} errors
          </span>
        )}

        {displayedLeads.length > 0 && (
          <span className="toolbar__count">{displayedLeads.length} lead{displayedLeads.length !== 1 ? 's' : ''}</span>
        )}

        <button
          className="toolbar__btn"
          onClick={checkAllReplies}
          disabled={checkAllRunning || leads.length === 0}
          title="Check all contacted leads for new replies"
        >
          <RefreshCw size={13} /> Update All
        </button>
      </Toolbar>

      {/* Content area: split pane when composer open, full table otherwise */}
      {composerLeadId !== null ? (
        <SplitPane
          storageKey="tracking-composer-width"
          defaultLeftWidth={520}
          minLeftWidth={320}
          maxLeftWidth={720}
          left={tableContent}
          right={composerPanel}
        />
      ) : (
        tableContent
      )}

    </div>
  );
}
