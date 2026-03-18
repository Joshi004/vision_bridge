import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { RefreshCw, Check, ChevronRight } from "lucide-react";
import SplitPane from "../components/SplitPane";
import Toolbar, { ToolbarDivider, ToolbarSpacer } from "../components/Toolbar";
import { useListKeyboardNav } from "../hooks/useListKeyboardNav";
import { DraggableLeadRow } from "../components/DraggableLeadRow";

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

function getInitials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();
}

export default function DraftsPage() {
  const [leads, setLeads] = useState<LeadWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Per-lead edit state
  const [editState, setEditState] = useState<Record<number, EditEntry>>({});

  // Per-lead action-in-progress
  const [savingId, setSavingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Per-lead queue state: tracks send-initial jobs from the queue engine
  const [queueState, setQueueState] = useState<Record<number, CardQueueInfo>>({});

  // Aggregate queue progress for status indicator
  const [queueProgress, setQueueProgress] = useState<{ active: number; remaining: number } | null>(null);

  // Transient "Saved ✓" indicator per lead
  const [savedId, setSavedId] = useState<number | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Inline send confirmation state (delete uses native OS dialog)
  const [confirmSendId, setConfirmSendId] = useState<number | null>(null);

  // Per-lead inline error messages
  const [cardErrors, setCardErrors] = useState<Record<number, string>>({});

  // Per-lead custom instruction text
  const [customInstructions, setCustomInstructions] = useState<Record<number, string>>({});

  // Per-lead async operation locks
  const [regeneratingId, setRegeneratingId] = useState<number | null>(null);
  const [refreshingProfileId, setRefreshingProfileId] = useState<number | null>(null);
  const [refreshingBothId, setRefreshingBothId] = useState<number | null>(null);

  // Refresh All progress: null when idle
  const [refreshAllState, setRefreshAllState] = useState<{ current: number; total: number } | null>(null);
  const refreshAllCancelledRef = useRef(false);

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Unsaved-edits dialog state for bulk send
  const [showUnsavedEditsDialog, setShowUnsavedEditsDialog] = useState(false);
  const [unsavedEditIds, setUnsavedEditIds] = useState<number[]>([]);
  const [bulkSendReadyIds, setBulkSendReadyIds] = useState<number[]>([]);

  // Leads highlighted after "Cancel and review" in unsaved-edits dialog
  const [highlightedUnsavedIds, setHighlightedUnsavedIds] = useState<Set<number>>(new Set());

  // Ref for the Select All checkbox so we can set indeterminate state
  const selectAllRef = useRef<HTMLInputElement | null>(null);

  // Ref for the draft textarea so double-click can focus it
  const draftTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Ref for the conversation thread container so we can scroll to bottom
  const draftThreadRef = useRef<HTMLDivElement | null>(null);

  // ── Phase 6: Master-detail state ────────────────────────────────────────────

  // Which lead is shown in the detail pane
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);

  // Toolbar search & sort
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<'name' | 'persona' | 'status'>('name');

  // ── Data fetching ──────────────────────────────────────────────────────────

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await window.api.getLeadsByStage("draft");
      setLeads(data);
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

  // Listen for global refresh shortcut
  useEffect(() => {
    const handler = () => fetchLeads();
    window.addEventListener("visionbridge:refresh", handler);
    return () => window.removeEventListener("visionbridge:refresh", handler);
  }, [fetchLeads]);

  // Scroll conversation thread to bottom when a lead is selected
  useEffect(() => {
    if (selectedLeadId !== null && draftThreadRef.current) {
      setTimeout(() => {
        draftThreadRef.current!.scrollTop = draftThreadRef.current!.scrollHeight;
      }, 50);
    }
  }, [selectedLeadId]);

  // ── Queue progress subscription ─────────────────────────────────────────────

  const progressHandlerRef = useRef<QueueProgressHandler | null>(null);

  useEffect(() => {
    function buildQueueStateFromItems(items: QueueItemStatus[]): Record<number, CardQueueInfo> {
      const state: Record<number, CardQueueInfo> = {};
      for (const item of items) {
        if (item.type !== 'send-initial') continue;
        const leadId = item.payload.leadId as number | undefined;
        if (leadId === undefined) continue;
        if (item.status === 'queued' || item.status === 'active' || item.status === 'failed') {
          state[leadId] = { jobId: item.id, status: item.status, error: item.error };
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
        setSelectedLeadId((prev) => (prev === leadId ? null : prev));
      } else if (item.status === 'cancelled') {
        setQueueState((prev) => {
          const n = { ...prev };
          delete n[leadId];
          updateQueueProgress(n);
          return n;
        });
      } else {
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

  // Prune selectedIds when leads change
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
    el.indeterminate = selectedIds.size > 0 && selectedIds.size < filteredLeads.length;
  }); // runs every render to keep it accurate after filtering

  // ── Derived list (search + sort) ────────────────────────────────────────────

  const filteredLeads = (() => {
    let list = [...leads];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (l) =>
          (l.profile.name ?? "").toLowerCase().includes(q) ||
          (l.role ?? "").toLowerCase().includes(q) ||
          (l.company ?? "").toLowerCase().includes(q) ||
          (l.persona ?? "").toLowerCase().includes(q)
      );
    }
    list.sort((a, b) => {
      if (sortKey === 'name') {
        return (a.profile.name ?? "").localeCompare(b.profile.name ?? "");
      }
      if (sortKey === 'persona') {
        return (a.persona ?? "").localeCompare(b.persona ?? "");
      }
      // sortKey === 'status': failed > active > queued > idle
      const rank = (l: LeadWithProfile) => {
        const q = queueState[l.id];
        if (!q) return 0;
        if (q.status === 'failed') return 3;
        if (q.status === 'active') return 2;
        if (q.status === 'queued') return 1;
        return 0;
      };
      return rank(b) - rank(a);
    });
    return list;
  })();

  // ── Keyboard navigation ────────────────────────────────────────────────────

  const { focusedIndex: kbFocusedIndex } = useListKeyboardNav({
    items: filteredLeads,
    selectedId: selectedLeadId,
    onSelect: (id) => setSelectedLeadId((prev) => (prev === id ? null : id)),
    onDelete: (id) => handleDeleteLead(id),
    onToggleCheckbox: (id) => toggleSelectById(id),
    onSelectAll: toggleSelectAll,
    onSave: (id) => saveDraft(id),
    onSend: (id) => setConfirmSendId(id),
    getId: (l) => l.id,
  });

  // ── Bulk selection helpers ─────────────────────────────────────────────────

  function toggleSelect(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    toggleSelectById(id);
  }

  function toggleSelectById(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    setHighlightedUnsavedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === filteredLeads.length && filteredLeads.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredLeads.map((l) => l.id)));
    }
  }

  function handleTextChange(id: number, value: string) {
    setEditState((prev) => ({ ...prev, [id]: { ...prev[id], edited: value } }));
  }

  function handleRestore(id: number) {
    setEditState((prev) => ({ ...prev, [id]: { ...prev[id], edited: prev[id].original } }));
  }

  // ── Lead update helpers ───────────────────────────────────────────────────

  function applyUpdatedLead(updated: LeadWithProfile) {
    setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
    const msg = updated.initial_message ?? "";
    setEditState((prev) => ({ ...prev, [updated.id]: { edited: msg, original: msg } }));
  }

  function applyUpdatedLeadProfileOnly(updated: LeadWithProfile) {
    setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
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

  // ── Save draft ──────────────────────────────────────────────────────────────

  async function saveDraft(id: number) {
    const entry = editState[id];
    if (!entry || entry.edited === entry.original) return;

    setSavingId(id);
    clearCardError(id);
    try {
      await window.api.updateLeadDraft(id, entry.edited);
      setEditState((prev) => ({ ...prev, [id]: { edited: entry.edited, original: entry.edited } }));
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

  async function handleDeleteLead(id: number) {
    const lead = leads.find((l) => l.id === id);
    const name = lead?.profile.name ?? "this lead";
    const confirmed = await window.api.showConfirmDialog(
      "Delete Lead",
      `Delete "${name}"? This cannot be undone.`
    );
    if (confirmed) await deleteLead(id);
  }

  async function deleteLead(id: number) {
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
      setSelectedLeadId((prev) => (prev === id ? null : prev));
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
        setQueueState((prev) => ({ ...prev, [id]: { jobId: result.jobId, status: 'queued' } }));
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
    setQueueState((prev) => {
      const n = { ...prev };
      delete n[id];
      return n;
    });
  }

  async function retrySend(id: number) {
    const cardQueue = queueState[id];
    if (!cardQueue?.jobId) return;
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

      if (!message) { setCardError(id, 'No message to send.'); continue; }
      if (!lead.profile.linkedin_url) { setCardError(id, 'No LinkedIn URL found.'); continue; }

      const cardQueue = queueState[id];
      if (cardQueue?.status === 'queued' || cardQueue?.status === 'active') continue;

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
          setQueueState((prev) => ({ ...prev, [id]: { jobId: result.jobId, status: 'queued' } }));
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

  async function handleBulkDelete() {
    const count = selectedIds.size;
    const confirmed = await window.api.showConfirmDialog(
      "Delete Leads",
      `Delete ${count} draft${count !== 1 ? 's' : ''}? This cannot be undone.`
    );
    if (confirmed) await executeBulkDelete();
  }

  async function executeBulkDelete() {
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
      setSelectedLeadId((prev) => (prev !== null && idSet.has(prev) ? null : prev));
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
      if ("success" in result && result.success === false) { setCardError(id, result.error); return; }
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
      if ("success" in result && result.success === false) { setCardError(id, result.error); return; }
      applyUpdatedLead(result as LeadWithProfile);
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
      if ("success" in result && result.success === false) { setCardError(id, result.error); return; }
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
      if ("success" in result && result.success === false) { setCardError(id, result.error); return; }
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
        console.error(`Refresh All: failed for lead ${snapshot[i].id}`, err);
      }
    }

    setRefreshAllState(null);
    await fetchLeads();
  }

  function cancelRefreshAll() {
    refreshAllCancelledRef.current = true;
  }

  // ── Context menu ─────────────────────────────────────────────────────────────

  async function handleContextMenu(e: React.MouseEvent, lead: LeadWithProfile) {
    e.preventDefault();
    const id = lead.id;
    const cardQueue = queueState[id];
    const isBusyRow =
      savingId === id ||
      deletingId === id ||
      cardQueue?.status === 'queued' ||
      cardQueue?.status === 'active' ||
      regeneratingId === id ||
      refreshingProfileId === id ||
      refreshingBothId === id;
    const isDirty = editState[id]
      ? editState[id].edited !== editState[id].original
      : false;
    const draftText = editState[id]?.edited ?? lead.initial_message ?? "";

    const action = await window.api.showContextMenu([
      { id: 'edit', label: 'Edit Draft', enabled: true },
      { id: 'regenerate', label: 'Regenerate Draft', enabled: !isBusyRow },
      { id: 'sep1', label: '', type: 'separator' },
      { id: 'send', label: 'Send', enabled: !isBusyRow },
      { id: 'save', label: 'Save Draft', enabled: isDirty && !isBusyRow },
      { id: 'sep2', label: '', type: 'separator' },
      { id: 'refresh-profile', label: 'Refresh Profile', enabled: !isBusyRow && !isRefreshingAll },
      { id: 'refresh-draft', label: 'Refresh Draft', enabled: !isBusyRow },
      { id: 'refresh-both', label: 'Refresh Both', enabled: !isBusyRow && !isRefreshingAll },
      { id: 'sep3', label: '', type: 'separator' },
      { id: 'copy-draft', label: 'Copy Draft Text', enabled: draftText.length > 0 },
      { id: 'open-linkedin', label: 'Open LinkedIn Profile', enabled: !!lead.profile.linkedin_url },
      { id: 'sep4', label: '', type: 'separator' },
      { id: 'delete', label: 'Delete', enabled: !isBusyRow },
    ]);

    if (!action) return;
    switch (action) {
      case 'edit':
        setSelectedLeadId(id);
        break;
      case 'regenerate':
        await regenerateDraft(id);
        break;
      case 'send':
        setConfirmSendId(id);
        setSelectedLeadId(id);
        break;
      case 'save':
        await saveDraft(id);
        break;
      case 'refresh-profile':
        await refreshProfile(id);
        break;
      case 'refresh-draft':
        await regenerateDraft(id);
        break;
      case 'refresh-both':
        await refreshBoth(id);
        break;
      case 'copy-draft':
        await navigator.clipboard.writeText(draftText);
        break;
      case 'open-linkedin':
        window.open(lead.profile.linkedin_url, '_blank', 'noopener,noreferrer');
        break;
      case 'delete':
        await handleDeleteLead(id);
        break;
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="drafts-layout">
        <div className="drafts-status-fill">
          <span className="bulk-spinner" aria-hidden="true" />
          Loading drafts…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="drafts-layout">
        <div className="drafts-status-fill drafts-status-fill--error">
          <p>{error}</p>
          <button className="btn btn-secondary" onClick={fetchLeads}>Retry</button>
        </div>
      </div>
    );
  }

  const isRefreshingAll = refreshAllState !== null;
  const hasBulkSelection = selectedIds.size > 0;
  const selectedLead = selectedLeadId !== null ? leads.find((l) => l.id === selectedLeadId) ?? null : null;

  // ── Left pane: compact lead list ────────────────────────────────────────────

  const leadList = (
    <div className="drafts-list">
      {filteredLeads.length === 0 && (
        <div className="drafts-list__empty">
          {leads.length === 0 ? (
            <>
              <p>No drafts yet.</p>
              <p className="drafts-list__empty-hint">
                <Link to="/">Go to Compose</Link> to add leads.
              </p>
            </>
          ) : (
            <p>No results for "{searchQuery}"</p>
          )}
        </div>
      )}
      {filteredLeads.map((lead, listIdx) => {
        const id = lead.id;
        const cardQueue = queueState[id];
        const isQueued = cardQueue?.status === 'queued';
        const isActivelySending = cardQueue?.status === 'active';
        const isFailed = cardQueue?.status === 'failed';
        const isRowSelected = selectedLeadId === id;
        const isChecked = selectedIds.has(id);
        const isUnsavedHighlighted = highlightedUnsavedIds.has(id);
        const isKeyboardFocused = listIdx === kbFocusedIndex;
        const name = lead.profile.name ?? "LinkedIn Profile";

        const queueClass = isActivelySending
          ? " drafts-list-row--sending"
          : isQueued
          ? " drafts-list-row--queued"
          : isFailed
          ? " drafts-list-row--failed"
          : "";
        const selectedClass = isRowSelected ? " drafts-list-row--active" : "";
        const highlightClass = isUnsavedHighlighted ? " drafts-list-row--unsaved" : "";
        const focusedClass = isKeyboardFocused ? " drafts-list-row--keyboard-focused" : "";

        return (
          <DraggableLeadRow
            key={id}
            leadId={id}
            leadName={name}
            currentStage="draft"
            className={`drafts-list-row${queueClass}${selectedClass}${highlightClass}${focusedClass}`}
            onClick={() => setSelectedLeadId(isRowSelected ? null : id)}
            onDoubleClick={() => {
              setSelectedLeadId(id);
              setTimeout(() => draftTextareaRef.current?.focus(), 50);
            }}
            onContextMenu={(e) => handleContextMenu(e, lead)}
          >
            <input
              type="checkbox"
              className="drafts-list-row__checkbox"
              checked={isChecked}
              onChange={() => {}}
              onClick={(e) => toggleSelect(id, e)}
              aria-label={`Select ${name}`}
            />
            <div className="drafts-list-row__avatar" aria-hidden="true">
              {getInitials(name)}
            </div>
            <div className="drafts-list-row__info">
              <span className="drafts-list-row__name">{name}</span>
              {(lead.role || lead.company) && (
                <span className="drafts-list-row__sub">
                  {[lead.role, lead.company].filter(Boolean).join(" · ")}
                </span>
              )}
            </div>
            {lead.persona && (
              <span className={`meta-tag persona-${lead.persona} drafts-list-row__persona`}>
                {PERSONA_LABELS[lead.persona] ?? lead.persona}
              </span>
            )}
            {isActivelySending && (
              <span className="drafts-list-row__status-dot drafts-list-row__status-dot--sending" title="Sending…" />
            )}
            {isQueued && (
              <span className="drafts-list-row__status-dot drafts-list-row__status-dot--queued" title="Queued" />
            )}
            {isFailed && (
              <span className="drafts-list-row__status-dot drafts-list-row__status-dot--failed" title="Failed" />
            )}
          </DraggableLeadRow>
        );
      })}
    </div>
  );

  // ── Right pane: detail panel ─────────────────────────────────────────────────

  const detailPanel = (() => {
    if (!selectedLead) {
      return (
        <div className="drafts-detail__empty">
          <p>Select a draft to view</p>
        </div>
      );
    }

    const id = selectedLead.id;
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
    const isBusy = isSaving || isDeleting || isInQueue || isRegenerating || isRefreshingProfile || isRefreshingBothCard;
    const isSaved = savedId === id;
    const cardError = cardErrors[id];
    const name = selectedLead.profile.name ?? "LinkedIn Profile";
    const messages = selectedLead.recentMessages.slice(-10);
    const customInstruction = customInstructions[id] ?? "";
    const wordCount = (entry?.edited ?? "").trim().split(/\s+/).filter(Boolean).length;

    return (
      <div className="drafts-detail">
        {/* Profile header */}
        <div className="drafts-detail__profile-header">
          <div className="drafts-detail__profile-identity">
            <a
              href={selectedLead.profile.linkedin_url}
              target="_blank"
              rel="noopener noreferrer"
              className="drafts-detail__name person-link"
            >
              {name}
            </a>
            {(selectedLead.role || selectedLead.company) && (
              <span className="drafts-detail__role">
                {[selectedLead.role, selectedLead.company].filter(Boolean).join(" · ")}
              </span>
            )}
            <div className="drafts-detail__tags">
              {selectedLead.persona && (
                <span className={`meta-tag persona-${selectedLead.persona}`}>
                  {PERSONA_LABELS[selectedLead.persona] ?? selectedLead.persona}
                </span>
              )}
              {selectedLead.message_state && (
                <span className="meta-tag state">
                  {STATE_LABELS[selectedLead.message_state] ?? selectedLead.message_state}
                </span>
              )}
            </div>
          </div>
          <div className="drafts-detail__profile-actions">
            <button
              className={`drafts-card__refresh-btn${isRefreshingProfile ? " drafts-card__refresh-btn--spinning" : ""}`}
              onClick={() => refreshProfile(id)}
              disabled={isBusy || isRefreshingAll}
              title="Refresh profile info"
              aria-label="Refresh profile info"
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        {/* Conversation history */}
        {messages.length > 0 && (
          <div ref={draftThreadRef} className="replies-detail__thread drafts-detail__conversation-thread">
            {messages.map((msg, i) => {
              const isSelf = msg.sender === "self";
              return (
                <div key={i} className={`replies-msg replies-msg--${isSelf ? "self" : "them"}`}>
                  <div className="replies-msg__meta">
                    <span className="replies-msg__sender">{isSelf ? "You" : name}</span>
                    {msg.timestamp && (
                      <span className="replies-msg__date">
                        {new Date(msg.timestamp).toLocaleDateString("en-US", {
                          month: "short", day: "numeric", year: "numeric",
                        })}
                      </span>
                    )}
                  </div>
                  <p className="replies-msg__text">{msg.content}</p>
                </div>
              );
            })}
          </div>
        )}

        {/* Draft editor */}
        <div className="drafts-detail__editor">
          {/* Editor toolbar */}
          <div className="drafts-detail__editor-toolbar">
            <span className="drafts-detail__editor-label">
              Draft message
              {isDirty && <span className="draft-card__unsaved-badge">unsaved</span>}
            </span>
            <div className="drafts-detail__editor-actions">
              <button
                className="btn btn-restore btn--sm"
                onClick={() => handleRestore(id)}
                disabled={!isDirty || isBusy}
                title="Reset to last saved version"
              >
                Restore
              </button>
              <button
                className="btn btn-regen btn--sm"
                onClick={() => regenerateDraft(id)}
                disabled={isBusy}
                title="Regenerate draft"
              >
                {isRegenerating ? (
                  <><span className="bulk-spinner-inline" aria-hidden="true" />Regenerating…</>
                ) : (
                  <span className="btn-icon">
                    <RefreshCw size={12} /> Regenerate
                  </span>
                )}
              </button>
              <span className="drafts-detail__word-count">{wordCount}w</span>
            </div>
          </div>

          <textarea
            ref={draftTextareaRef}
            className="draft-textarea drafts-detail__textarea"
            value={entry?.edited ?? ""}
            onChange={(e) => handleTextChange(id, e.target.value)}
            disabled={isBusy}
            rows={8}
          />

          {/* Custom instruction regenerate */}
          <div className="drafts-detail__regen-instruction">
            <input
              type="text"
              className="drafts-more-instruction-input"
              placeholder="Make it more casual, focus on their AI work…"
              value={customInstruction}
              onChange={(e) => setCustomInstructions((prev) => ({ ...prev, [id]: e.target.value }))}
              disabled={isBusy}
            />
            <button
              className="btn btn-regen btn--sm"
              onClick={() => regenerateWithInstruction(id)}
              disabled={isBusy || !customInstruction.trim()}
            >
              {isRegenerating ? (
                <><span className="bulk-spinner-inline" aria-hidden="true" />Regenerating…</>
              ) : (
                "Apply"
              )}
            </button>
          </div>
        </div>

        {/* Inline send confirmation */}
        {confirmSendId === id && (
          <div className="drafts-confirm">
            <span className="drafts-confirm__text">Send this message to {name}?</span>
            <div className="drafts-confirm__actions">
              <button className="btn btn-send btn--sm" onClick={() => sendLead(id)}>Confirm Send</button>
              <button className="btn btn-secondary btn--sm" onClick={() => setConfirmSendId(null)}>Cancel</button>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="drafts-detail__actions">
          <button
            className="btn btn-save-draft"
            onClick={() => saveDraft(id)}
            disabled={!isDirty || isBusy}
          >
            {isSaving ? "Saving…" : isSaved
              ? <span className="btn-icon">Saved <Check size={14} /></span>
              : "Save Draft"}
          </button>

          <button
            className="btn btn-delete"
            onClick={() => { setConfirmSendId(null); handleDeleteLead(id); }}
            disabled={isBusy}
          >
            {isDeleting ? "Deleting…" : "Delete"}
          </button>

          <button
            className="btn btn-send drafts-detail__send-btn"
            onClick={() => { setConfirmSendId(id); }}
            disabled={isBusy}
          >
            {isActivelySending ? "Sending…"
              : isQueued ? "Queued"
              : isDirty ? "Save & Send"
              : <span className="btn-icon">Send <ChevronRight size={14} /></span>}
          </button>

          {isQueued && (
            <button className="btn btn-secondary btn--sm" onClick={() => handleCancelQueuedSend(id)}>
              Cancel
            </button>
          )}
        </div>

        {/* Refresh options */}
        <div className="drafts-detail__refresh-row">
          <span className="drafts-detail__refresh-label">Refresh:</span>
          <button
            className="btn btn-refresh btn--sm"
            onClick={() => refreshBoth(id)}
            disabled={isBusy || isRefreshingAll}
          >
            {isRefreshingBothCard
              ? <><span className="bulk-spinner-inline" aria-hidden="true" />Refreshing…</>
              : <span className="btn-icon"><RefreshCw size={12} /> Both</span>}
          </button>
          <button
            className="btn btn-refresh btn--sm"
            onClick={() => regenerateDraft(id)}
            disabled={isBusy}
          >
            <span className="btn-icon"><RefreshCw size={12} /> Draft only</span>
          </button>
        </div>

        {/* Outreach angle info */}
        {selectedLead.outreach_angle && (
          <div className="drafts-detail__angle">
            <span className="drafts-detail__angle-label">Outreach angle:</span>{" "}
            {selectedLead.outreach_angle}
          </div>
        )}

        {/* Failed send error with retry */}
        {isFailed && cardQueue?.error && (
          <div className="drafts-card__error drafts-card__error--failed">
            <span>{cardQueue.error}</span>
            <button className="btn btn-send btn--sm" onClick={() => retrySend(id)}>Retry</button>
          </div>
        )}

        {/* Per-lead inline error */}
        {cardError && <div className="drafts-card__error">{cardError}</div>}
      </div>
    );
  })();

  // ── Page render ──────────────────────────────────────────────────────────────

  return (
    <div className="drafts-layout">
      {/* Toolbar */}
      <Toolbar>
        {!hasBulkSelection ? (
          <>
            <input
              ref={selectAllRef}
              type="checkbox"
              className="toolbar__checkbox"
              checked={filteredLeads.length > 0 && selectedIds.size === filteredLeads.length}
              onChange={toggleSelectAll}
              aria-label="Select all drafts"
              disabled={filteredLeads.length === 0}
            />
            {isRefreshingAll ? (
              <>
                <span className="drafts-refresh-all-progress">
                  Refreshing {refreshAllState!.current} / {refreshAllState!.total}…
                </span>
                <button className="btn btn-secondary btn--sm" onClick={cancelRefreshAll}>
                  Cancel
                </button>
              </>
            ) : (
              <button
                className="toolbar__btn"
                onClick={refreshAll}
                disabled={leads.length === 0}
                title="Re-scrape all draft profiles"
              >
                <span className="btn-icon">
                  <RefreshCw size={13} /> Refresh All
                </span>
              </button>
            )}
            {queueProgress && queueProgress.remaining > 0 && (
              <span className="drafts-queue-progress">
                {queueProgress.active > 0
                  ? `Sending 1 of ${queueProgress.remaining}…`
                  : `${queueProgress.remaining} queued…`}
              </span>
            )}
            <ToolbarDivider />
            <input
              type="search"
              className="toolbar__search"
              placeholder="Search…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search drafts"
            />
            <select
              className="toolbar__select"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as typeof sortKey)}
              aria-label="Sort drafts"
            >
              <option value="name">Sort: Name</option>
              <option value="persona">Sort: Persona</option>
              <option value="status">Sort: Status</option>
            </select>
            <ToolbarSpacer />
            {leads.length > 0 && (
              <span className="toolbar__count">{leads.length} draft{leads.length !== 1 ? 's' : ''}</span>
            )}
          </>
        ) : (
          <>
            <span className="toolbar__bulk-count">{selectedIds.size} selected</span>
            <button className="btn btn-send btn--sm" onClick={handleBulkSend}>
              Send ({selectedIds.size})
            </button>
            <button className="btn btn-delete btn--sm" onClick={handleBulkDelete}>
              Delete ({selectedIds.size})
            </button>
            <ToolbarSpacer />
            <button className="toolbar__deselect" onClick={() => setSelectedIds(new Set())}>
              Deselect All
            </button>
          </>
        )}
      </Toolbar>

      {/* Split pane */}
      <SplitPane
        storageKey="drafts-split-width"
        defaultLeftWidth={300}
        minLeftWidth={200}
        maxLeftWidth={480}
        left={leadList}
        right={detailPanel}
      />

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
    </div>
  );
}
