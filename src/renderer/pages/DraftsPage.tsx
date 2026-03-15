import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";

interface EditEntry {
  edited: string;
  original: string;
}

export default function DraftsPage() {
  const [leads, setLeads] = useState<LeadWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Per-card edit state: { [leadId]: { edited, original } }
  const [editState, setEditState] = useState<Record<number, EditEntry>>({});

  // Per-card action-in-progress (existing)
  const [savingId, setSavingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [sendingId, setSendingId] = useState<number | null>(null);

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

  // Per-card custom instruction text
  const [customInstructions, setCustomInstructions] = useState<Record<number, string>>({});

  // Per-card async operation locks
  const [regeneratingId, setRegeneratingId] = useState<number | null>(null);
  const [refreshingProfileId, setRefreshingProfileId] = useState<number | null>(null);
  const [refreshingBothId, setRefreshingBothId] = useState<number | null>(null);

  // Refresh All progress: null when idle
  const [refreshAllState, setRefreshAllState] = useState<{ current: number; total: number } | null>(null);
  const refreshAllCancelledRef = useRef(false);

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

  // ── Edit helpers ────────────────────────────────────────────────────────────

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
    setSendingId(id);
    clearCardError(id);

    const entry = editState[id];
    const currentText = entry?.edited;

    try {
      const result = await window.api.sendLead(id, currentText);
      if (!result.success) {
        let msg = result.error;
        if ("needsLogin" in result && result.needsLogin) {
          msg = "Your LinkedIn session has expired. Please log in again via the Compose page.";
        }
        setCardError(id, msg);
        return;
      }
      setLeads((prev) => prev.filter((l) => l.id !== id));
      setEditState((prev) => {
        const n = { ...prev };
        delete n[id];
        return n;
      });
    } catch (err) {
      setCardError(id, err instanceof Error ? err.message : "Failed to send message.");
    } finally {
      setSendingId(null);
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
          <h2 className="drafts-title">
            Drafts
            {leads.length > 0 && (
              <span className="drafts-count-badge">{leads.length}</span>
            )}
          </h2>
          <div className="drafts-header__actions">
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

      {/* Card list */}
      <div className="drafts-card-list">
        {leads.map((lead) => {
          const id = lead.id;
          const entry = editState[id];
          const isDirty = entry ? entry.edited !== entry.original : false;
          const isSaving = savingId === id;
          const isDeleting = deletingId === id;
          const isSending = sendingId === id;
          const isRegenerating = regeneratingId === id;
          const isRefreshingProfile = refreshingProfileId === id;
          const isRefreshingBothCard = refreshingBothId === id;
          const isBusy =
            isSaving ||
            isDeleting ||
            isSending ||
            isRegenerating ||
            isRefreshingProfile ||
            isRefreshingBothCard;
          const isSaved = savedId === id;
          const cardError = cardErrors[id];
          const name = lead.profile.name ?? "LinkedIn Profile";
          const lastTwoMessages = lead.recentMessages.slice(-2);
          const isMoreOpen = moreOpenIds.has(id);
          const customInstruction = customInstructions[id] ?? "";

          return (
            <div key={id} className="drafts-card">
              {/* Card header */}
              <div className="drafts-card__header">
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
                    return (
                      <div
                        key={i}
                        className={`msg-bubble msg-bubble--${isSelf ? "self" : "them"}`}
                      >
                        <span className="msg-bubble__label">
                          {isSelf ? "You" : "Them"}
                        </span>
                        <span className="msg-bubble__text">{msg.content}</span>
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
                  {isSending ? "Sending…" : isDirty ? "Save & Send" : "Send ▸"}
                </button>
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
    </div>
  );
}
