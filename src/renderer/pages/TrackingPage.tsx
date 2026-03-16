import { useState, useEffect, useCallback, useRef } from "react";

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
} {
  const now = new Date();
  const followUpNumber = lead.follow_up_count < lead.max_follow_ups
    ? lead.follow_up_count + 1
    : null;

  if (!lead.next_follow_up_at || followUpNumber === null) {
    return { nextLabel: "All follow-ups sent", isOverdue: false, daysText: "", followUpNumber: null };
  }

  const dueDate = new Date(lead.next_follow_up_at);
  const diffMs = dueDate.getTime() - now.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    const overdueDays = Math.abs(diffDays);
    return {
      nextLabel: `Follow-Up ${followUpNumber}`,
      isOverdue: true,
      daysText: `OVERDUE by ${overdueDays} day${overdueDays !== 1 ? "s" : ""} ⚠`,
      followUpNumber,
    };
  }

  if (diffDays === 0) {
    return {
      nextLabel: `Follow-Up ${followUpNumber}`,
      isOverdue: false,
      daysText: `due today (${formatDate(lead.next_follow_up_at)})`,
      followUpNumber,
    };
  }

  return {
    nextLabel: `Follow-Up ${followUpNumber}`,
    isOverdue: false,
    daysText: `due in ${diffDays} day${diffDays !== 1 ? "s" : ""} (${formatDate(lead.next_follow_up_at)})`,
    followUpNumber,
  };
}

function isOverdue(lead: LeadWithProfile): boolean {
  if (!lead.next_follow_up_at || lead.follow_up_count >= lead.max_follow_ups) return false;
  return new Date(lead.next_follow_up_at) < new Date();
}

// ── Sorting helpers ──────────────────────────────────────────────────────────

type SortBy = "next_action_due" | "initial_sent_date" | "name";
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

const STATE_LABELS: Record<string, string> = {
  inbound_referral: "Inbound Referral",
  outbound_referral: "Outbound Referral",
  inbound_recruitment: "Inbound Recruitment",
  outbound_recruitment: "Outbound Recruitment",
  inbound_other: "Inbound",
  outbound_other: "Outbound",
};

function sortLeads(leads: LeadWithProfile[], sortBy: SortBy): LeadWithProfile[] {
  const sorted = [...leads];
  if (sortBy === "next_action_due") {
    sorted.sort((a, b) => {
      // Nulls (all FUs exhausted) go last
      if (!a.next_follow_up_at && !b.next_follow_up_at) return 0;
      if (!a.next_follow_up_at) return 1;
      if (!b.next_follow_up_at) return -1;
      return new Date(a.next_follow_up_at).getTime() - new Date(b.next_follow_up_at).getTime();
    });
  } else if (sortBy === "initial_sent_date") {
    sorted.sort((a, b) => {
      if (!a.initial_sent_at && !b.initial_sent_at) return 0;
      if (!a.initial_sent_at) return 1;
      if (!b.initial_sent_at) return -1;
      return new Date(b.initial_sent_at).getTime() - new Date(a.initial_sent_at).getTime();
    });
  } else {
    sorted.sort((a, b) => {
      const nameA = a.profile.name ?? "";
      const nameB = b.profile.name ?? "";
      return nameA.localeCompare(nameB);
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
    // Include the full "to" day
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
  const [filterBy, setFilterBy] = useState<FilterBy>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Per-card action states
  const [checkingReplyId, setCheckingReplyId] = useState<number | null>(null);
  const [markingColdId, setMarkingColdId] = useState<number | null>(null);
  const [confirmColdId, setConfirmColdId] = useState<number | null>(null);
  const [cardErrors, setCardErrors] = useState<Record<number, string>>({});

  // Update All state
  const [checkAllRunning, setCheckAllRunning] = useState(false);
  const [checkAllResult, setCheckAllResult] = useState<{ checked: number; repliesFound: number; errors: number } | null>(null);

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

  // Progress tracking for "Update All" check-all-replies
  const [checkAllProgress, setCheckAllProgress] = useState<{
    total: number; completed: number; repliesFound: number; errors: number;
  } | null>(null);

  // Notification toast
  const [notification, setNotification] = useState<string | null>(null);
  const notifTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressHandlerRef = useRef<ReturnType<typeof window.api.queue.onProgress> | null>(null);
  const checkAllProgressRef = useRef<{ total: number; completed: number; repliesFound: number; errors: number } | null>(null);
  const onOverdueChangeRef = useRef(onOverdueChange);

  // ── Helpers ──────────────────────────────────────────────────────────────

  const showNotification = useCallback((msg: string) => {
    if (notifTimerRef.current) clearTimeout(notifTimerRef.current);
    setNotification(msg);
    notifTimerRef.current = setTimeout(() => setNotification(null), 3500);
  }, []);

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

  // Keep onOverdueChangeRef current so the queue handler always has the latest prop.
  useEffect(() => {
    onOverdueChangeRef.current = onOverdueChange;
  }, [onOverdueChange]);

  // Subscribe to queue progress events; sync with in-flight jobs on mount.
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
          // Close composer if it's open for this lead
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
          // queued or active
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
    setConfirmColdId(null);
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
        // checkAllRunning stays true; progress listener handles completion.
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

  async function markCold(id: number) {
    setConfirmColdId(null);
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
        // Composer stays open showing "Queued"; progress listener closes it on completion.
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

  // ── Derived display list ──────────────────────────────────────────────────

  const composerLead = leads.find((l) => l.id === composerLeadId) ?? null;
  const displayedLeads = filterLeads(sortLeads(leads, sortBy), filterBy, dateFrom, dateTo);

  // Composer queue state derived from followUpQueueState
  const composerQueueInfo = composerLeadId != null ? followUpQueueState[composerLeadId] : undefined;
  const isComposerQueued = composerQueueInfo?.status === 'queued';
  const isComposerActivelySending = composerQueueInfo?.status === 'active' || composerSending;
  const isComposerFailed = composerQueueInfo?.status === 'failed';
  const isComposerInQueue = isComposerQueued || isComposerActivelySending;

  // ── Render: loading / error ───────────────────────────────────────────────

  if (loading) {
    return (
      <div className="tracking-container">
        <div className="drafts-loading">
          <span className="bulk-spinner" aria-hidden="true" />
          Loading contacts…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="tracking-container">
        <div className="drafts-error">
          <p>{error}</p>
          <button className="btn btn-secondary" onClick={fetchLeads}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="tracking-container">
      {/* Page header */}
      <div className="tracking-header">
        <div className="tracking-header__top">
          <h2 className="tracking-title">
            Tracking
            {leads.length > 0 && (
              <span className="drafts-count-badge">{leads.length}</span>
            )}
          </h2>
          <div className="tracking-header__actions">
            {checkAllRunning ? (
              <span className="drafts-refresh-all-progress">
                <span className="bulk-spinner-inline" aria-hidden="true" />
                {checkAllProgress
                  ? `Checking ${checkAllProgress.completed} of ${checkAllProgress.total}…`
                  : 'Checking all…'}
              </span>
            ) : checkAllResult ? (
              <span className="tracking-check-all-result">
                Checked {checkAllResult.checked} · {checkAllResult.repliesFound} replies · {checkAllResult.errors} errors
              </span>
            ) : null}
            <button
              className="drafts-refresh-all-btn"
              onClick={checkAllReplies}
              disabled={checkAllRunning || leads.length === 0}
              title="Check all contacted leads for new replies"
            >
              Update All ↻
            </button>
          </div>
        </div>

        {/* Controls bar */}
        <div className="tracking-controls">
          <select
            className="filter-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
          >
            <option value="next_action_due">Sort: Next action due</option>
            <option value="initial_sent_date">Sort: Initial sent date</option>
            <option value="name">Sort: Name</option>
          </select>

          <select
            className="filter-select"
            value={filterBy}
            onChange={(e) => setFilterBy(e.target.value as FilterBy)}
          >
            <option value="all">Filter: All</option>
            <option value="overdue">Filter: Overdue only</option>
          </select>

          <div className="tracking-date-range">
            <label className="tracking-date-label">From</label>
            <input
              type="date"
              className="tracking-date-input"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
            <label className="tracking-date-label">To</label>
            <input
              type="date"
              className="tracking-date-input"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Empty state */}
      {leads.length === 0 && (
        <div className="drafts-empty">
          <p>No contacted leads yet.</p>
          <p className="drafts-empty__hint">
            Send initial messages from the Drafts page to start tracking follow-ups.
          </p>
        </div>
      )}

      {/* Filtered-to-empty state */}
      {leads.length > 0 && displayedLeads.length === 0 && (
        <div className="drafts-empty">
          <p>No leads match the current filter.</p>
          <p className="drafts-empty__hint">
            Try changing the filter or date range.
          </p>
        </div>
      )}

      {/* Card list */}
      <div className="drafts-card-list">
        {displayedLeads.map((lead) => {
          const id = lead.id;
          const name = lead.profile.name ?? "LinkedIn Profile";
          const cardError = cardErrors[id];
          const isCheckingReply = checkingReplyId === id;
          const isMarkingCold = markingColdId === id;
          const isBusy = isCheckingReply || isMarkingCold || checkAllRunning;
          const cadence = getCadenceStatus(lead);

          const lastSentLabel = lead.last_contacted_at
            ? formatDate(lead.last_contacted_at)
            : lead.initial_sent_at
            ? formatDate(lead.initial_sent_at)
            : "—";

          return (
            <div key={id} className="drafts-card tracking-card">
              {/* Card header */}
              <div className="drafts-card__header" style={{ cursor: "default" }}>
                <div className="drafts-card__identity">
                  <a
                    href={lead.profile.linkedin_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="drafts-card__name person-link"
                  >
                    {name}
                  </a>
                  {(lead.role || lead.company) && (
                    <span className="drafts-card__role">
                      {[lead.role, lead.company].filter(Boolean).join(" · ")}
                    </span>
                  )}
                  {lead.persona && (
                    <span className={`meta-tag persona-${lead.persona}`}>
                      {PERSONA_LABELS[lead.persona] ?? lead.persona}
                    </span>
                  )}
                  {lead.message_state && (
                    <span className="meta-tag state">
                      {STATE_LABELS[lead.message_state] ?? lead.message_state}
                    </span>
                  )}
                </div>
              </div>

              {/* Cadence status block */}
              <div className="tracking-cadence">
                <div className="tracking-cadence__row">
                  <span className="tracking-cadence__label">Initial sent:</span>
                  <span className="tracking-cadence__value">{formatDate(lead.initial_sent_at)}</span>
                </div>
                <div className="tracking-cadence__row">
                  <span className="tracking-cadence__label">Follow-ups:</span>
                  <span className="tracking-cadence__value">
                    {lead.follow_up_count} / {lead.max_follow_ups} sent
                  </span>
                </div>
                <div className="tracking-cadence__row">
                  <span className="tracking-cadence__label">Next:</span>
                  {cadence.followUpNumber ? (
                    <span className={`tracking-cadence__value${cadence.isOverdue ? " tracking-cadence__value--overdue" : ""}`}>
                      {cadence.nextLabel} — {cadence.daysText}
                    </span>
                  ) : (
                    <span className="tracking-cadence__value tracking-cadence__value--exhausted">
                      All follow-ups sent
                    </span>
                  )}
                </div>
                <div className="tracking-cadence__row">
                  <span className="tracking-cadence__label">Last sent:</span>
                  <span className="tracking-cadence__value">{lastSentLabel}</span>
                </div>
              </div>

              {/* Inline cold confirmation */}
              {confirmColdId === id && (
                <div className="drafts-confirm">
                  <span className="drafts-confirm__text">
                    Mark {name} as Cold? This will move them out of Tracking.
                  </span>
                  <div className="drafts-confirm__actions">
                    <button
                      className="btn btn-delete btn--sm"
                      onClick={() => markCold(id)}
                    >
                      Confirm
                    </button>
                    <button
                      className="btn btn-secondary btn--sm"
                      onClick={() => setConfirmColdId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div className="drafts-card__actions tracking-card__actions">
                <button
                  className="btn btn-send"
                  onClick={() => {
                    setConfirmColdId(null);
                    openComposer(lead);
                  }}
                  disabled={isBusy || cadence.followUpNumber === null}
                  title={cadence.followUpNumber === null ? "All follow-ups have been sent" : undefined}
                >
                  {formatFollowUpLabel(cadence.followUpNumber ?? lead.max_follow_ups)}
                </button>

                <button
                  className="btn btn-delete"
                  onClick={() => {
                    setConfirmColdId(id === confirmColdId ? null : id);
                  }}
                  disabled={isBusy}
                >
                  {isMarkingCold ? "Marking…" : "Mark as Cold"}
                </button>

                <button
                  className="btn btn-refresh tracking-card__update-btn"
                  onClick={() => checkReply(id)}
                  disabled={isBusy}
                >
                  {isCheckingReply ? (
                    <>
                      <span className="bulk-spinner-inline" aria-hidden="true" />
                      Checking…
                    </>
                  ) : (
                    "Update ↻"
                  )}
                </button>
              </div>

              {/* Per-card inline error */}
              {cardError && (
                <div className="drafts-card__error">{cardError}</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Follow-Up Composer modal */}
      {composerLeadId !== null && (
        <div className="fu-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) closeComposer(); }}>
          <div className="fu-modal">
            <div className="fu-modal__header">
              <h3 className="fu-modal__title">
                {composerGenerating
                  ? "Generating…"
                  : composerData
                  ? `${formatFollowUpLabel(composerData.followUpNumber)} for ${composerLead?.profile.name ?? "Contact"}`
                  : "Follow-Up Composer"}
              </h3>
              <button
                className="fu-modal__close"
                onClick={closeComposer}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {composerGenerating && (
              <div className="fu-modal__generating">
                <span className="bulk-spinner" aria-hidden="true" />
                Generating follow-up…
              </div>
            )}

            {!composerGenerating && composerError && (
              <div className="fu-modal__error">
                <p>{composerError}</p>
                <button className="btn btn-secondary btn--sm" onClick={closeComposer}>
                  Close
                </button>
              </div>
            )}

            {!composerGenerating && composerData && (
              <>
                {/* Prior messages */}
                <div className="fu-modal__prior-section">
                  <span className="fu-modal__section-label">Previous messages</span>
                  <div className="fu-modal__prior-list">
                    {composerData.priorMessages.map((msg) => {
                      const isSelf = msg.sender === "self";
                      return (
                        <div
                          key={msg.id}
                          className={`fu-prior-msg fu-prior-msg--${isSelf ? "self" : "them"}`}
                        >
                          <div className="fu-prior-msg__meta">
                            <span className="fu-prior-msg__sender">
                              {isSelf ? "You" : "Them"}
                            </span>
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

                {/* Editable textarea */}
                <div className="fu-modal__composer-section">
                  <span className="fu-modal__section-label">Suggested follow-up</span>
                  <textarea
                    className="draft-textarea fu-modal__textarea"
                    value={composerEditedMessage}
                    onChange={(e) => setComposerEditedMessage(e.target.value)}
                    disabled={composerSending}
                    rows={8}
                  />
                </div>

                {composerError && !isComposerFailed && (
                  <div className="fu-modal__send-error">{composerError}</div>
                )}

                {isComposerFailed && composerQueueInfo?.error && (
                  <div className="fu-modal__send-error">
                    <span>{composerQueueInfo.error}</span>
                    <button
                      className="btn btn-send btn--sm"
                      onClick={async () => {
                        if (composerQueueInfo?.jobId) {
                          setComposerError(null);
                          // Re-enqueue the failed job; progress event will update state
                          await window.api.queue.retry(composerQueueInfo.jobId);
                        }
                      }}
                    >
                      Retry
                    </button>
                  </div>
                )}

                {/* Actions */}
                <div className="fu-modal__actions">
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
                      <>
                        <span className="bulk-spinner-inline" aria-hidden="true" />
                        Sending…
                      </>
                    ) : isComposerQueued ? (
                      'Queued'
                    ) : (
                      'Send ▸'
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Toast notification */}
      {notification && (
        <div className="tracking-toast" role="status">
          {notification}
        </div>
      )}
    </div>
  );
}
