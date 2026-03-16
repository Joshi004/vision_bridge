import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";

interface EditEntry {
  edited: string;
  original: string;
}

interface CardQueueInfo {
  jobId: string;
  status: 'queued' | 'active' | 'completed' | 'failed';
  error?: string;
}

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

export default function DraftsPage() {
  const [leads, setLeads] = useState<LeadWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Per-card edit state: { [leadId]: { edited, original } }
  const [editState, setEditState] = useState<Record<number, EditEntry>>({});

  // Per-card action-in-progress (existing)
  const [savingId, setSavingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Per-card queue state: tracks send-initial jobs from the queue engine
  const [queueState, setQueueState] = useState<Record<number, CardQueueInfo>>({});

  // Aggregate queue progress for the header indicator
  const [queueProgress, setQueueProgress] = useState<{ active: number; remaining: number } | null>(null);

  // Transient "Saved ✓" indicator per card
  const [savedId, setSavedId] = useState<number | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Inline confirmation state
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [confirmSendId, setConfirmSendId] = useState<number | null>(null);

  // Per-card inline error messages
  const [cardErrors, setCardErrors] = useState<Record<number, string>>({});

  // ── Sub-Phase 2.5 state ────────────────────────────────────────────────────

  // Which cards have "More options" expanded
  const [moreOpenIds, setMoreOpenIds] = useState<Set<number>>(new Set());

  // Which message bubbles are expanded (key: "{leadId}-{msgIndex}")
  const [expandedMsgs, setExpandedMsgs] = useState<Set<string>>(new Set());

  const toggleMsg = (key: string) => {
    setExpandedMsgs((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  // Per-card custom instruction text
  const [customInstructions, setCustomInstructions] = useState<Record<number, string>>({});

  // Per-card async operation locks
  const [regeneratingId, setRegeneratingId] = useState<number | null>(null);
  const [refreshingProfileId, setRefreshingProfileId] = useState<number | null>(null);
  const [refreshingBothId, setRefreshingBothId] = useState<number | null>(null);

  // Refresh All progress: null when idle
  const [refreshAllState, setRefreshAllState] = useState<{ current: number; total: number } | null>(null);
  const refreshAllCancelledRef = useRef(false);

  // ── Phase 8: Bulk selection ────────────────────────────────────────────────

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Unsaved-edits dialog state for bulk send
  const [showUnsavedEditsDialog, setShowUnsavedEditsDialog] = useState(false);
  const [unsavedEditIds, setUnsavedEditIds] = useState<number[]>([]);
  const [bulkSendReadyIds, setBulkSendReadyIds] = useState<number[]>([]);

  // Bulk delete confirmation dialog
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false);

  // Cards highlighted after "Cancel and review" in unsaved-edits dialog
  const [highlightedUnsavedIds, setHighlightedUnsavedIds] = useState<Set<number>>(new Set());

  // Ref for the Select All checkbox so we can set indeterminate state
  const selectAllRef = useRef<HTMLInputElement | null>(null);

  // ── Data fetching ──────────────────────────────────────────────────────────

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await window.api.getLeadsByStage("draft");
      setLeads(data);
      // Initialise edit state for all cards on first load
      setEditState((prev) => {
        const next = { ...prev };
        for (const lead of data) {
          if (!next[lead.id]) {
            const msg = lead.initial_message ?? "";
            next[lead.id] = { edited: msg, original: msg };
          }
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load drafts.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  // ── Queue progress subscription ─────────────────────────────────────────────

  const progressHandlerRef = useRef<QueueProgressHandler | null>(null);

  useEffect(() => {
    // Helper to rebuild queueState from a snapshot of queue items
    function buildQueueStateFromItems(items: QueueItemStatus[]): Record<number, CardQueueInfo> {
      const state: Record<number, CardQueueInfo> = {};
      for (const item of items) {
        if (item.type !== 'send-initial') continue;
        const leadId = item.payload.leadId as number | undefined;
        if (leadId === undefined) continue;
        if (item.status === 'queued' || item.status === 'active' || item.status === 'failed') {
          state[leadId] = {
            jobId: item.id,
            status: item.status,
            error: item.error,
          };
        }
      }
      return state;
    }

    function updateQueueProgress(state: Record<number, CardQueueInfo>) {
      const values = Object.values(state);
      const active = values.filter((v) => v.status === 'active').length;
      const remaining = values.filter((v) => v.status === 'queued' || v.status === 'active').length;
      setQueueProgress(remaining > 0 ? { active, remaining } : null);
    }

    // Sync with any jobs already in the queue on mount
    window.api.queue.getStatus().then((snapshot) => {
      const allItems = [...snapshot.actionQueue];
      const initialState = buildQueueStateFromItems(allItems);
      setQueueState(initialState);
      updateQueueProgress(initialState);
    });

    const handler = window.api.queue.onProgress((item) => {
      if (item.type !== 'send-initial') return;
      const leadId = item.payload.leadId as number | undefined;
      if (leadId === undefined) return;

      if (item.status === 'completed') {
        // Lead has transitioned to contacted — remove from drafts list
        setLeads((prev) => prev.filter((l) => l.id !== leadId));
        setEditState((prev) => {
          const n = { ...prev };
          delete n[leadId];
          return n;
        });
        setQueueState((prev) => {
          const n = { ...prev };
          delete n[leadId];
          updateQueueProgress(n);
          return n;
        });
      } else if (item.status === 'cancelled') {
        setQueueState((prev) => {
          const n = { ...prev };
          delete n[leadId];
          updateQueueProgress(n);
          return n;
        });
      } else {
        // queued, active, or failed
        setQueueState((prev) => {
          const n = {
            ...prev,
            [leadId]: {
              jobId: item.id,
              status: item.status as CardQueueInfo['status'],
              error: item.error,
            },
          };
          updateQueueProgress(n);
          return n;
        });
      }
    });

    progressHandlerRef.current = handler;

    return () => {
      if (progressHandlerRef.current) {
        window.api.queue.removeProgressListener(progressHandlerRef.current);
        progressHandlerRef.current = null;
      }
    };
  }, []);

  // Prune selectedIds when the leads list changes (filter/refresh/deletion)
  useEffect(() => {
    if (selectedIds.size === 0) return;
    const leadIdSet = new Set(leads.map((l) => l.id));
    setSelectedIds((prev) => {
      const pruned = new Set([...prev].filter((id) => leadIdSet.has(id)));
      return pruned.size === prev.size ? prev : pruned;
    });
  }, [leads]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the Select All checkbox indeterminate state in sync
  useEffect(() => {
    const el = selectAllRef.current;
    if (!el) return;
    el.indeterminate = selectedIds.size > 0 && selectedIds.size < leads.length;
  }, [selectedIds, leads]);

  // ── Bulk selection helpers ─────────────────────────────────────────────────

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    // Clicking a card clears its unsaved highlight
    setHighlightedUnsavedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === leads.length && leads.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(leads.map((l) => l.id)));
    }
  }

  function handleTextChange(id: number, value: string) {
    setEditState((prev) => ({
      ...prev,
      [id]: { ...prev[id], edited: value },
    }));
  }

  function handleRestore(id: number) {
    setEditState((prev) => ({
      ...prev,
      [id]: { ...prev[id], edited: prev[id].original },
    }));
  }

  // ── Sub-Phase 2.5 helpers ──────────────────────────────────────────────────

  /** Replace a lead in state AND reset the edit textarea to the new message. */
  function applyUpdatedLead(updated: LeadWithProfile) {
    setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
    const msg = updated.initial_message ?? "";
    setEditState((prev) => ({
      ...prev,
      [updated.id]: { edited: msg, original: msg },
    }));
  }

  /** Replace a lead in state but preserve the user's current textarea content. */
  function applyUpdatedLeadProfileOnly(updated: LeadWithProfile) {
    setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
    // editState intentionally untouched
  }

  function clearCardError(id: number) {
    setCardErrors((prev) => {
      const n = { ...prev };
      delete n[id];
      return n;
    });
  }

  function setCardError(id: number, msg: string) {
    setCardErrors((prev) => ({ ...prev, [id]: msg }));
  }

  function toggleMoreOptions(id: number) {
    setMoreOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  // ── Save draft ──────────────────────────────────────────────────────────────

  async function saveDraft(id: number) {
    const entry = editState[id];
    if (!entry || entry.edited === entry.original) return;

    setSavingId(id);
    clearCardError(id);
    try {
      await window.api.updateLeadDraft(id, entry.edited);
      setEditState((prev) => ({
        ...prev,
        [id]: { edited: entry.edited, original: entry.edited },
      }));
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      setSavedId(id);
      savedTimerRef.current = setTimeout(() => setSavedId(null), 2000);
    } catch (err) {
      setCardError(id, err instanceof Error ? err.message : "Failed to save draft.");
    } finally {
      setSavingId(null);
    }
  }

  // ── Delete lead ─────────────────────────────────────────────────────────────

  async function deleteLead(id: number) {
    setConfirmDeleteId(null);
    setDeletingId(id);
    clearCardError(id);
    try {
      await window.api.deleteLead(id);
      setLeads((prev) => prev.filter((l) => l.id !== id));
      setEditState((prev) => {
        const n = { ...prev };
        delete n[id];
        return n;
      });
    } catch (err) {
      setCardError(id, err instanceof Error ? err.message : "Failed to delete lead.");
    } finally {
      setDeletingId(null);
    }
  }

  // ── Send lead ───────────────────────────────────────────────────────────────

  async function sendLead(id: number) {
    setConfirmSendId(null);
    clearCardError(id);

    const entry = editState[id];
    const currentText = entry?.edited;

    try {
      const result = await window.api.sendLead(id, currentText);
      if ('queued' in result && result.queued) {
        setQueueState((prev) => ({
          ...prev,
          [id]: { jobId: result.jobId, status: 'queued' },
        }));
      } else if ('success' in result && result.success === false) {
        let msg = result.error;
        if ('needsLogin' in result && result.needsLogin) {
          msg = "Your LinkedIn session has expired. Please log in again via the Compose page.";
        }
        setCardError(id, msg);
      }
    } catch (err) {
      setCardError(id, err instanceof Error ? err.message : "Failed to send message.");
    }
  }

  async function handleCancelQueuedSend(id: number) {
    const info = queueState[id];
    if (!info) return;
    await window.api.queue.cancel(info.jobId);
    // Optimistic removal — the cancelled progress event will also clean up,
    // but we remove immediately so the card returns to idle state right away.
    setQueueState((prev) => {
      const n = { ...prev };
      delete n[id];
      return n;
    });
  }

  async function retrySend(id: number) {
    const cardQueue = queueState[id];
    if (!cardQueue?.jobId) return;
    // Re-enqueue the failed job; the progress event from the new queued job
    // will update queueState[id] automatically.
    await window.api.queue.retry(cardQueue.jobId);
  }

  // ── Bulk send ───────────────────────────────────────────────────────────────

  async function handleBulkSend() {
    const ids = [...selectedIds];
    const validIds: number[] = [];

    for (const id of ids) {
      const lead = leads.find((l) => l.id === id);
      if (!lead) continue;

      const entry = editState[id];
      const message = entry?.edited?.trim() || lead.initial_message?.trim() || '';

      if (!message) {
        setCardError(id, 'No message to send.');
        continue;
      }
      if (!lead.profile.linkedin_url) {
        setCardError(id, 'No LinkedIn URL found.');
        continue;
      }
      const cardQueue = queueState[id];
      if (cardQueue?.status === 'queued' || cardQueue?.status === 'active') {
        continue;
      }
      validIds.push(id);
    }

    if (validIds.length === 0) return;

    const withUnsavedEdits = validIds.filter((id) => {
      const entry = editState[id];
      return entry && entry.edited !== entry.original;
    });

    if (withUnsavedEdits.length > 0) {
      setUnsavedEditIds(withUnsavedEdits);
      setBulkSendReadyIds(validIds);
      setShowUnsavedEditsDialog(true);
      return;
    }

    await executeBulkSend(validIds);
  }

  async function executeBulkSend(ids: number[]) {
    setShowUnsavedEditsDialog(false);
    for (const id of ids) {
      clearCardError(id);
      try {
        const result = await window.api.sendLead(id);
        if ('queued' in result && result.queued) {
          setQueueState((prev) => ({
            ...prev,
            [id]: { jobId: result.jobId, status: 'queued' },
          }));
        } else if ('success' in result && result.success === false) {
          let msg = result.error;
          if ('needsLogin' in result && result.needsLogin) {
            msg = 'Your LinkedIn session has expired. Please log in again via the Compose page.';
          }
          setCardError(id, msg);
        }
      } catch (err) {
        setCardError(id, err instanceof Error ? err.message : 'Failed to send message.');
      }
    }
    setSelectedIds(new Set());
  }

  // ── Bulk delete ─────────────────────────────────────────────────────────────

  async function executeBulkDelete() {
    setShowBulkDeleteDialog(false);
    const ids = [...selectedIds];
    try {
      await window.api.deleteLeads(ids);
      const idSet = new Set(ids);
      setLeads((prev) => prev.filter((l) => !idSet.has(l.id)));
      setEditState((prev) => {
        const n = { ...prev };
        for (const id of ids) delete n[id];
        return n;
      });
      setSelectedIds(new Set());
    } catch (err) {
      console.error('Bulk delete failed:', err);
    }
  }

  // ── Regenerate draft ────────────────────────────────────────────────────────

  async function regenerateDraft(id: number) {
    setRegeneratingId(id);
    clearCardError(id);
    try {
      const result = await window.api.regenerateDraft(id);
      if ("success" in result && result.success === false) {
        setCardError(id, result.error);
        return;
      }
      applyUpdatedLead(result as LeadWithProfile);
    } catch (err) {
      setCardError(id, err instanceof Error ? err.message : "Failed to regenerate draft.");
    } finally {
      setRegeneratingId(null);
    }
  }

  async function regenerateWithInstruction(id: number) {
    const instruction = customInstructions[id] ?? "";
    if (!instruction.trim()) return;

    setRegeneratingId(id);
    clearCardError(id);
    try {
      const result = await window.api.regenerateDraftWithInstruction(id, instruction);
      if ("success" in result && result.success === false) {
        setCardError(id, result.error);
        return;
      }
      applyUpdatedLead(result as LeadWithProfile);
      // Clear the instruction field after success
      setCustomInstructions((prev) => ({ ...prev, [id]: "" }));
    } catch (err) {
      setCardError(id, err instanceof Error ? err.message : "Failed to regenerate with instruction.");
    } finally {
      setRegeneratingId(null);
    }
  }

  // ── Refresh profile ─────────────────────────────────────────────────────────

  async function refreshProfile(id: number) {
    setRefreshingProfileId(id);
    clearCardError(id);
    try {
      const result = await window.api.refreshLeadProfile(id);
      if ("success" in result && result.success === false) {
        setCardError(id, result.error);
        return;
      }
      applyUpdatedLeadProfileOnly(result as LeadWithProfile);
    } catch (err) {
      setCardError(id, err instanceof Error ? err.message : "Failed to refresh profile.");
    } finally {
      setRefreshingProfileId(null);
    }
  }

  // ── Refresh both ────────────────────────────────────────────────────────────

  async function refreshBoth(id: number) {
    setRefreshingBothId(id);
    clearCardError(id);
    try {
      const result = await window.api.refreshLeadBoth(id);
      if ("success" in result && result.success === false) {
        setCardError(id, result.error);
        return;
      }
      applyUpdatedLead(result as LeadWithProfile);
    } catch (err) {
      setCardError(id, err instanceof Error ? err.message : "Failed to refresh lead.");
    } finally {
      setRefreshingBothId(null);
    }
  }

  // ── Refresh All ─────────────────────────────────────────────────────────────

  async function refreshAll() {
    const snapshot = [...leads];
    refreshAllCancelledRef.current = false;
    setRefreshAllState({ current: 0, total: snapshot.length });

    for (let i = 0; i < snapshot.length; i++) {
      if (refreshAllCancelledRef.current) break;

      setRefreshAllState({ current: i + 1, total: snapshot.length });
      try {
        const result = await window.api.refreshLeadProfile(snapshot[i].id);
        if (!("success" in result && result.success === false)) {
          applyUpdatedLeadProfileOnly(result as LeadWithProfile);
        }
      } catch (err) {
        // Silently skip individual failures — don't abort the batch
        console.error(`Refresh All: failed for lead ${snapshot[i].id}`, err);
      }
    }

    setRefreshAllState(null);
    // Re-fetch everything to ensure state is fully consistent
    await fetchLeads();
  }

  function cancelRefreshAll() {
    refreshAllCancelledRef.current = true;
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="drafts-container">
        <div className="drafts-loading">
          <span className="bulk-spinner" aria-hidden="true" />
          Loading drafts…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="drafts-container">
        <div className="drafts-error">
          <p>{error}</p>
          <button className="btn btn-secondary" onClick={fetchLeads}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  const isRefreshingAll = refreshAllState !== null;

  return (
    <div className="drafts-container">
      {/* Page header */}
      <div className="drafts-header">
        <div className="drafts-header__top">
          <div className="drafts-title-row">
            {leads.length > 0 && (
              <input
                ref={selectAllRef}
                type="checkbox"
                className="drafts-header__select-all"
                checked={leads.length > 0 && selectedIds.size === leads.length}
                onChange={toggleSelectAll}
                aria-label="Select all drafts"
              />
            )}
            <h2 className="drafts-title">
              Drafts
              {leads.length > 0 && (
                <span className="drafts-count-badge">{leads.length}</span>
              )}
            </h2>
          </div>
          <div className="drafts-header__actions">
            {queueProgress && queueProgress.remaining > 0 && (
              <span className="drafts-queue-progress">
                {queueProgress.active > 0
                  ? `Sending 1 of ${queueProgress.remaining}…`
                  : `${queueProgress.remaining} queued…`}
              </span>
            )}
            {isRefreshingAll && (
              <span className="drafts-refresh-all-progress">
                Refreshing {refreshAllState.current} / {refreshAllState.total}…
              </span>
            )}
            {isRefreshingAll ? (
              <button
                className="btn btn-secondary btn--sm"
                onClick={cancelRefreshAll}
              >
                Cancel
              </button>
            ) : (
              <button
                className="drafts-refresh-all-btn"
                onClick={refreshAll}
                disabled={leads.length === 0}
                title="Re-scrape all draft profiles (does not change draft messages)"
              >
                Refresh All ↻
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Empty state */}
      {leads.length === 0 && (
        <div className="drafts-empty">
          <p>No drafts yet.</p>
          <p className="drafts-empty__hint">
            <Link to="/">Go to Compose</Link> to add new leads.
          </p>
        </div>
      )}

      {/* Bulk delete confirmation dialog */}
      {showBulkDeleteDialog && (
        <div className="bulk-dialog-overlay">
          <div className="bulk-dialog">
            <p className="bulk-dialog__message">
              Delete {selectedIds.size} draft{selectedIds.size !== 1 ? 's' : ''}? This cannot be undone.
            </p>
            <div className="bulk-dialog__actions">
              <button className="btn btn-delete" onClick={executeBulkDelete}>
                Delete
              </button>
              <button className="btn btn-secondary" onClick={() => setShowBulkDeleteDialog(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unsaved edits dialog for bulk send */}
      {showUnsavedEditsDialog && (
        <div className="bulk-dialog-overlay">
          <div className="bulk-dialog">
            <p className="bulk-dialog__message">
              {unsavedEditIds.length} selected draft{unsavedEditIds.length !== 1 ? 's have' : ' has'} unsaved edits.
              What would you like to do?
            </p>
            <div className="bulk-dialog__actions">
              <button className="btn btn-send" onClick={() => executeBulkSend(bulkSendReadyIds)}>
                Send saved versions
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setShowUnsavedEditsDialog(false);
                  setHighlightedUnsavedIds(new Set(unsavedEditIds));
                }}
              >
                Cancel and review
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Card list */}
      <div className="drafts-card-list">
        {leads.map((lead) => {
          const id = lead.id;
          const entry = editState[id];
          const isDirty = entry ? entry.edited !== entry.original : false;
          const isSaving = savingId === id;
          const isDeleting = deletingId === id;
          const cardQueue = queueState[id];
          const isQueued = cardQueue?.status === 'queued';
          const isActivelySending = cardQueue?.status === 'active';
          const isFailed = cardQueue?.status === 'failed';
          const isInQueue = isQueued || isActivelySending;
          const isRegenerating = regeneratingId === id;
          const isRefreshingProfile = refreshingProfileId === id;
          const isRefreshingBothCard = refreshingBothId === id;
          const isBusy =
            isSaving ||
            isDeleting ||
            isInQueue ||
            isRegenerating ||
            isRefreshingProfile ||
            isRefreshingBothCard;
          const isSaved = savedId === id;
          const cardError = cardErrors[id];
          const name = lead.profile.name ?? "LinkedIn Profile";
          const lastTwoMessages = lead.recentMessages.slice(-2);
          const isMoreOpen = moreOpenIds.has(id);
          const customInstruction = customInstructions[id] ?? "";

          // CSS modifier class for the card based on queue state and selection
          const isSelected = selectedIds.has(id);
          const isUnsavedHighlighted = highlightedUnsavedIds.has(id);
          const cardQueueClass = isActivelySending
            ? " drafts-card--sending"
            : isQueued
            ? " drafts-card--queued"
            : isFailed
            ? " drafts-card--failed"
            : "";
          const cardSelectedClass = isSelected ? " drafts-card--selected" : "";
          const cardHighlightClass = isUnsavedHighlighted ? " drafts-card--unsaved-highlight" : "";

          return (
            <div key={id} className={`drafts-card${cardQueueClass}${cardSelectedClass}${cardHighlightClass}`}>
              {/* Card header */}
              <div className="drafts-card__header">
                <input
                  type="checkbox"
                  className="drafts-card__checkbox"
                  checked={isSelected}
                  onChange={() => toggleSelect(id)}
                  aria-label={`Select ${name}`}
                />
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
                <button
                  className={`drafts-card__refresh-btn${isRefreshingProfile ? " drafts-card__refresh-btn--spinning" : ""}`}
                  onClick={() => refreshProfile(id)}
                  disabled={isBusy || isRefreshingAll}
                  title="Refresh profile info"
                  aria-label="Refresh profile"
                >
                  ↻
                </button>
              </div>

              {/* Recent conversation preview */}
              <div className="drafts-card__conversation">
                {lastTwoMessages.length === 0 ? (
                  <span className="drafts-card__no-msgs">No prior conversation</span>
                ) : (
                  lastTwoMessages.map((msg, i) => {
                    const isSelf = msg.sender === "self";
                    const msgKey = `${id}-${i}`;
                    const isExpanded = expandedMsgs.has(msgKey);
                    return (
                      <div
                        key={i}
                        className={`msg-bubble msg-bubble--${isSelf ? "self" : "them"}`}
                        onClick={() => toggleMsg(msgKey)}
                        title={isExpanded ? "Click to collapse" : "Click to expand"}
                      >
                        <span className="msg-bubble__label">
                          {isSelf ? "You" : "Them"}
                        </span>
                        <span className={`msg-bubble__text${isExpanded ? " msg-bubble__text--expanded" : ""}`}>
                          {msg.content}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Draft message textarea */}
              <div className="drafts-card__editor">
                <label className="drafts-card__editor-label">
                  Draft message
                  {isDirty && (
                    <span className="draft-card__unsaved-badge">unsaved</span>
                  )}
                </label>
                <textarea
                  className="draft-textarea drafts-card__textarea"
                  value={entry?.edited ?? ""}
                  onChange={(e) => handleTextChange(id, e.target.value)}
                  disabled={isBusy}
                  rows={6}
                />
              </div>

              {/* Inline delete confirmation */}
              {confirmDeleteId === id && (
                <div className="drafts-confirm">
                  <span className="drafts-confirm__text">
                    Delete this lead? This cannot be undone.
                  </span>
                  <div className="drafts-confirm__actions">
                    <button
                      className="btn btn-delete btn--sm"
                      onClick={() => deleteLead(id)}
                    >
                      Delete
                    </button>
                    <button
                      className="btn btn-secondary btn--sm"
                      onClick={() => setConfirmDeleteId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Inline send confirmation */}
              {confirmSendId === id && (
                <div className="drafts-confirm">
                  <span className="drafts-confirm__text">
                    Send this message to {name}?
                  </span>
                  <div className="drafts-confirm__actions">
                    <button
                      className="btn btn-send btn--sm"
                      onClick={() => sendLead(id)}
                    >
                      Confirm Send
                    </button>
                    <button
                      className="btn btn-secondary btn--sm"
                      onClick={() => setConfirmSendId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Action bar */}
              <div className="drafts-card__actions">
                <button
                  className="btn btn-restore"
                  onClick={() => handleRestore(id)}
                  disabled={!isDirty || isBusy}
                  title="Reset to last saved version"
                >
                  Restore
                </button>

                <button
                  className="btn btn-save-draft"
                  onClick={() => saveDraft(id)}
                  disabled={!isDirty || isBusy}
                >
                  {isSaving ? "Saving…" : isSaved ? "Saved ✓" : "Save Draft"}
                </button>

                <button
                  className="btn btn-delete"
                  onClick={() => {
                    setConfirmSendId(null);
                    setConfirmDeleteId(id);
                  }}
                  disabled={isBusy}
                >
                  {isDeleting ? "Deleting…" : "Delete"}
                </button>

                <button
                  className="btn btn-send drafts-card__send-btn"
                  onClick={() => {
                    setConfirmDeleteId(null);
                    setConfirmSendId(id);
                  }}
                  disabled={isBusy}
                >
                  {isActivelySending ? "Sending…" : isQueued ? "Queued" : isDirty ? "Save & Send" : "Send ▸"}
                </button>

                {isQueued && (
                  <button
                    className="btn btn-secondary btn--sm"
                    onClick={() => handleCancelQueuedSend(id)}
                  >
                    Cancel
                  </button>
                )}
              </div>

              {/* More options toggle */}
              <button
                className={`drafts-more-toggle${isMoreOpen ? " drafts-more-toggle--open" : ""}`}
                onClick={() => toggleMoreOptions(id)}
              >
                <span className="drafts-more-toggle__chevron">{isMoreOpen ? "▴" : "▾"}</span>
                {isMoreOpen ? "Less options" : "More options"}
              </button>

              {/* More options collapsible section */}
              {isMoreOpen && (
                <div className="drafts-more-section">

                  {/* Regenerate sub-section */}
                  <div className="drafts-more-section__group">
                    <span className="drafts-more-section__label">Regenerate</span>
                    <div className="drafts-more-section__row">
                      <button
                        className="btn btn-regen"
                        onClick={() => regenerateDraft(id)}
                        disabled={isBusy}
                      >
                        {isRegenerating ? (
                          <>
                            <span className="bulk-spinner-inline" aria-hidden="true" />
                            Regenerating…
                          </>
                        ) : (
                          "↻ Regenerate Draft"
                        )}
                      </button>
                    </div>
                    <input
                      type="text"
                      className="drafts-more-instruction-input"
                      placeholder="Make it more casual, focus on their AI work…"
                      value={customInstruction}
                      onChange={(e) =>
                        setCustomInstructions((prev) => ({ ...prev, [id]: e.target.value }))
                      }
                      disabled={isBusy}
                    />
                    <div className="drafts-more-section__row">
                      <button
                        className="btn btn-regen"
                        onClick={() => regenerateWithInstruction(id)}
                        disabled={isBusy || !customInstruction.trim()}
                      >
                        {isRegenerating ? (
                          <>
                            <span className="bulk-spinner-inline" aria-hidden="true" />
                            Regenerating…
                          </>
                        ) : (
                          "↻ Regenerate with Instruction"
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Refresh sub-section */}
                  <div className="drafts-more-section__group">
                    <span className="drafts-more-section__label">Refresh</span>
                    <div className="drafts-more-section__row">
                      <button
                        className="btn btn-refresh"
                        onClick={() => refreshProfile(id)}
                        disabled={isBusy || isRefreshingAll}
                      >
                        {isRefreshingProfile ? (
                          <>
                            <span className="bulk-spinner-inline" aria-hidden="true" />
                            Refreshing…
                          </>
                        ) : (
                          "↻ Refresh Profile Info"
                        )}
                      </button>
                      <button
                        className="btn btn-refresh"
                        onClick={() => regenerateDraft(id)}
                        disabled={isBusy}
                      >
                        {isRegenerating ? (
                          <>
                            <span className="bulk-spinner-inline" aria-hidden="true" />
                            Refreshing…
                          </>
                        ) : (
                          "↻ Refresh Draft"
                        )}
                      </button>
                      <button
                        className="btn btn-refresh"
                        onClick={() => refreshBoth(id)}
                        disabled={isBusy || isRefreshingAll}
                      >
                        {isRefreshingBothCard ? (
                          <>
                            <span className="bulk-spinner-inline" aria-hidden="true" />
                            Refreshing…
                          </>
                        ) : (
                          "↻ Refresh Both"
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Info sub-section */}
                  <div className="drafts-more-section__group drafts-more-info">
                    {lead.outreach_angle && (
                      <p className="drafts-more-info__angle">
                        <span className="drafts-more-info__angle-label">Outreach angle:</span>{" "}
                        {lead.outreach_angle}
                      </p>
                    )}
                    <a
                      href={lead.profile.linkedin_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="drafts-more-info__profile-link"
                    >
                      View Profile ↗
                    </a>
                  </div>
                </div>
              )}

              {/* Failed send: error with retry button */}
              {isFailed && cardQueue?.error && (
                <div className="drafts-card__error drafts-card__error--failed">
                  <span>{cardQueue.error}</span>
                  <button
                    className="btn btn-send btn--sm"
                    onClick={() => retrySend(id)}
                  >
                    Retry
                  </button>
                </div>
              )}

              {/* Per-card inline error */}
              {cardError && (
                <div className="drafts-card__error">
                  {cardError}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Sticky bulk action bar — visible when 1+ cards are selected */}
      {selectedIds.size > 0 && (
        <div className="bulk-action-bar">
          <span className="bulk-action-bar__count">{selectedIds.size} selected</span>
          <button className="btn bulk-action-bar__send-btn" onClick={handleBulkSend}>
            Send Selected ({selectedIds.size})
          </button>
          <button className="btn bulk-action-bar__delete-btn" onClick={() => setShowBulkDeleteDialog(true)}>
            Delete Selected ({selectedIds.size})
          </button>
          <button className="bulk-action-bar__deselect" onClick={() => setSelectedIds(new Set())}>
            Deselect All
          </button>
        </div>
      )}
    </div>
  );
}
