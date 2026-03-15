import { useState, useEffect, useCallback, useRef } from "react";

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function messageTypeLabel(type: string): string {
  switch (type) {
    case "initial":
      return "(initial outreach)";
    case "follow_up_1":
      return "(follow-up 1)";
    case "follow_up_2":
      return "(follow-up 2)";
    case "follow_up_3":
      return "(follow-up 3)";
    case "reply_received":
      return "(reply)";
    default:
      return "";
  }
}

export default function RepliesPage() {
  const [leads, setLeads] = useState<LeadWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Full conversation threads per lead (populated on demand)
  const [threads, setThreads] = useState<Record<number, OutreachThreadMessage[]>>({});

  // Per-card reply composer text
  const [replyText, setReplyText] = useState<Record<number, string>>({});

  // Per-card async operation locks
  const [generatingId, setGeneratingId] = useState<number | null>(null);
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [markingConvertedId, setMarkingConvertedId] = useState<number | null>(null);
  const [markingColdId, setMarkingColdId] = useState<number | null>(null);

  // Inline confirmation states
  const [confirmConvertedId, setConfirmConvertedId] = useState<number | null>(null);
  const [confirmColdId, setConfirmColdId] = useState<number | null>(null);

  // Per-card inline errors
  const [cardErrors, setCardErrors] = useState<Record<number, string>>({});

  // Per-card update result indicators
  const [updateResults, setUpdateResults] = useState<Record<number, string>>({});
  const updateResultTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  // Transient "Sent ✓" indicator per card
  const [sentIds, setSentIds] = useState<Set<number>>(new Set());
  const sentTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  // Toast notification
  const [notification, setNotification] = useState<string | null>(null);
  const notifTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Update All progress
  const [updateAllState, setUpdateAllState] = useState<{ current: number; total: number } | null>(null);
  const [updateAllResult, setUpdateAllResult] = useState<{ checked: number; newMessages: number } | null>(null);

  // Scroll refs for conversation threads (auto-scroll to bottom)
  const threadRefs = useRef<Record<number, HTMLDivElement | null>>({});

  // ── Helpers ──────────────────────────────────────────────────────────────

  function showNotification(msg: string) {
    if (notifTimerRef.current) clearTimeout(notifTimerRef.current);
    setNotification(msg);
    notifTimerRef.current = setTimeout(() => setNotification(null), 3500);
  }

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

  function showUpdateResult(id: number, msg: string) {
    if (updateResultTimers.current[id]) clearTimeout(updateResultTimers.current[id]);
    setUpdateResults((prev) => ({ ...prev, [id]: msg }));
    updateResultTimers.current[id] = setTimeout(() => {
      setUpdateResults((prev) => {
        const n = { ...prev };
        delete n[id];
        return n;
      });
    }, 4000);
  }

  function showSent(id: number) {
    if (sentTimers.current[id]) clearTimeout(sentTimers.current[id]);
    setSentIds((prev) => new Set(prev).add(id));
    sentTimers.current[id] = setTimeout(() => {
      setSentIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 2000);
  }

  function scrollThreadToBottom(id: number) {
    const el = threadRefs.current[id];
    if (el) {
      setTimeout(() => {
        el.scrollTop = el.scrollHeight;
      }, 50);
    }
  }

  // ── Data fetching ─────────────────────────────────────────────────────────

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await window.api.getLeadsByStage("replied");
      setLeads(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load replies.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  // Auto-scroll thread to bottom when thread data changes
  useEffect(() => {
    for (const id of Object.keys(threads)) {
      scrollThreadToBottom(Number(id));
    }
  }, [threads]);

  // ── Generate Reply ────────────────────────────────────────────────────────

  async function generateReply(id: number) {
    const existingText = replyText[id] ?? "";
    if (
      existingText.trim() &&
      !window.confirm("This will overwrite your current draft. Continue?")
    ) {
      return;
    }

    setGeneratingId(id);
    clearCardError(id);
    try {
      const result = await window.api.generateReply(id);
      if ("success" in result && result.success === false) {
        setCardError(id, result.error);
        return;
      }
      const { generatedReply, conversationThread } = result as {
        generatedReply: string;
        conversationThread: OutreachThreadMessage[];
      };
      setThreads((prev) => ({ ...prev, [id]: conversationThread }));
      setReplyText((prev) => ({ ...prev, [id]: generatedReply }));
      scrollThreadToBottom(id);
    } catch (err) {
      setCardError(id, err instanceof Error ? err.message : "Failed to generate reply.");
    } finally {
      setGeneratingId(null);
    }
  }

  // ── Send Reply ────────────────────────────────────────────────────────────

  async function sendReply(id: number) {
    const message = replyText[id] ?? "";
    if (!message.trim()) return;

    setSendingId(id);
    clearCardError(id);
    try {
      const result = await window.api.sendReply(id, message.trim());
      if (!result.success) {
        let errMsg = result.error;
        if ("needsLogin" in result && result.needsLogin) {
          errMsg = "Your LinkedIn session has expired. Please log in again via the Compose page.";
        }
        setCardError(id, errMsg);
        return;
      }
      // Clear textarea
      setReplyText((prev) => ({ ...prev, [id]: "" }));
      // Optimistically append sent message to thread
      const sentMsg: OutreachThreadMessage = {
        id: Date.now(),
        lead_id: id,
        message_type: "reply_sent",
        sender: "self",
        message: message.trim(),
        sent_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      };
      setThreads((prev) => {
        const existing = prev[id] ?? [];
        return { ...prev, [id]: [...existing, sentMsg] };
      });
      showSent(id);
      scrollThreadToBottom(id);
    } catch (err) {
      setCardError(id, err instanceof Error ? err.message : "Failed to send reply.");
    } finally {
      setSendingId(null);
    }
  }

  // ── Update (single card) ──────────────────────────────────────────────────

  async function updateLead(id: number) {
    setUpdatingId(id);
    clearCardError(id);
    try {
      const result = await window.api.updateRepliedLead(id);
      if ("success" in result && result.success === false) {
        setCardError(id, result.error);
        return;
      }
      const { newMessagesFound, newMessageCount, conversationThread } = result as {
        newMessagesFound: boolean;
        newMessageCount: number;
        conversationThread: OutreachThreadMessage[];
      };
      setThreads((prev) => ({ ...prev, [id]: conversationThread }));
      scrollThreadToBottom(id);
      showUpdateResult(
        id,
        newMessagesFound ? `${newMessageCount} new message${newMessageCount !== 1 ? "s" : ""} found` : "No new messages"
      );
    } catch (err) {
      setCardError(id, err instanceof Error ? err.message : "Failed to update conversation.");
    } finally {
      setUpdatingId(null);
    }
  }

  // ── Mark as Converted ────────────────────────────────────────────────────

  async function markConverted(id: number) {
    setConfirmConvertedId(null);
    setMarkingConvertedId(id);
    clearCardError(id);
    try {
      const result = await window.api.markConverted(id);
      if (!result.success) {
        setCardError(id, result.error);
        return;
      }
      setLeads((prev) => prev.filter((l) => l.id !== id));
      showNotification("Lead marked as Converted.");
    } catch (err) {
      setCardError(id, err instanceof Error ? err.message : "Failed to mark as converted.");
    } finally {
      setMarkingConvertedId(null);
    }
  }

  // ── Mark as Cold ─────────────────────────────────────────────────────────

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
    } catch (err) {
      setCardError(id, err instanceof Error ? err.message : "Failed to mark as cold.");
    } finally {
      setMarkingColdId(null);
    }
  }

  // ── Update All ────────────────────────────────────────────────────────────

  async function updateAll() {
    const snapshot = [...leads];
    setUpdateAllState({ current: 0, total: snapshot.length });
    setUpdateAllResult(null);

    let totalNewMessages = 0;

    for (let i = 0; i < snapshot.length; i++) {
      const lead = snapshot[i];
      setUpdateAllState({ current: i + 1, total: snapshot.length });
      try {
        const result = await window.api.updateRepliedLead(lead.id);
        if (!("success" in result && result.success === false)) {
          const { newMessageCount, conversationThread } = result as {
            newMessagesFound: boolean;
            newMessageCount: number;
            conversationThread: OutreachThreadMessage[];
          };
          setThreads((prev) => ({ ...prev, [lead.id]: conversationThread }));
          totalNewMessages += newMessageCount;
        }
      } catch (err) {
        console.error(`Update All: failed for lead ${lead.id}`, err);
      }
    }

    setUpdateAllResult({ checked: snapshot.length, newMessages: totalNewMessages });
    setUpdateAllState(null);
    await fetchLeads();
  }

  // ── Render: loading / error ───────────────────────────────────────────────

  if (loading) {
    return (
      <div className="replies-container">
        <div className="drafts-loading">
          <span className="bulk-spinner" aria-hidden="true" />
          Loading replies…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="replies-container">
        <div className="drafts-error">
          <p>{error}</p>
          <button className="btn btn-secondary" onClick={fetchLeads}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  const isUpdateAllRunning = updateAllState !== null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="replies-container">
      {/* Page header */}
      <div className="replies-header">
        <div className="replies-header__top">
          <h2 className="replies-title">
            Replies
            {leads.length > 0 && (
              <span className="drafts-count-badge">{leads.length}</span>
            )}
          </h2>
          <div className="replies-header__actions">
            {isUpdateAllRunning && (
              <span className="drafts-refresh-all-progress">
                <span className="bulk-spinner-inline" aria-hidden="true" />
                Updating {updateAllState.current} / {updateAllState.total}…
              </span>
            )}
            {!isUpdateAllRunning && updateAllResult && (
              <span className="replies-update-all-result">
                {updateAllResult.checked} checked · {updateAllResult.newMessages} new message{updateAllResult.newMessages !== 1 ? "s" : ""}
              </span>
            )}
            <button
              className="drafts-refresh-all-btn"
              onClick={updateAll}
              disabled={isUpdateAllRunning || leads.length === 0}
              title="Re-check all replied leads for new messages"
            >
              Update All ↻
            </button>
          </div>
        </div>
      </div>

      {/* Empty state */}
      {leads.length === 0 && (
        <div className="drafts-empty">
          <p>No replies yet.</p>
          <p className="drafts-empty__hint">
            Replies will appear here automatically when contacts respond to your outreach.
          </p>
        </div>
      )}

      {/* Card list */}
      <div className="drafts-card-list">
        {leads.map((lead) => {
          const id = lead.id;
          const name = lead.profile.name ?? "LinkedIn Profile";
          const cardError = cardErrors[id];
          const isGenerating = generatingId === id;
          const isSending = sendingId === id;
          const isUpdating = updatingId === id;
          const isMarkingConverted = markingConvertedId === id;
          const isMarkingCold = markingColdId === id;
          const isBusy =
            isGenerating || isSending || isUpdating || isMarkingConverted || isMarkingCold || isUpdateAllRunning;
          const isSent = sentIds.has(id);
          const updateResult = updateResults[id];
          const fullThread = threads[id];
          const currentReplyText = replyText[id] ?? "";

          return (
            <div key={id} className="drafts-card replies-card">
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
                </div>
              </div>

              {/* Conversation thread */}
              <div
                className="replies-thread"
                ref={(el) => { threadRefs.current[id] = el; }}
              >
                {fullThread ? (
                  fullThread.map((msg) => {
                    const isSelf = msg.sender === "self";
                    const label = messageTypeLabel(msg.message_type);
                    return (
                      <div
                        key={msg.id}
                        className={`replies-msg replies-msg--${isSelf ? "self" : "them"}`}
                      >
                        <div className="replies-msg__meta">
                          <span className="replies-msg__sender">
                            {isSelf ? "You" : name}
                          </span>
                          {label && (
                            <span className="replies-msg__type-label">{label}</span>
                          )}
                          {msg.sent_at && (
                            <span className="replies-msg__date">{formatDate(msg.sent_at)}</span>
                          )}
                        </div>
                        <p className="replies-msg__text">{msg.message}</p>
                      </div>
                    );
                  })
                ) : (
                  lead.recentMessages.length === 0 ? (
                    <span className="drafts-card__no-msgs">No conversation history yet. Click Update to load.</span>
                  ) : (
                    lead.recentMessages.map((msg, i) => {
                      const isSelf = msg.sender === "self";
                      return (
                        <div
                          key={i}
                          className={`replies-msg replies-msg--${isSelf ? "self" : "them"}`}
                        >
                          <div className="replies-msg__meta">
                            <span className="replies-msg__sender">
                              {isSelf ? "You" : name}
                            </span>
                            {msg.timestamp && (
                              <span className="replies-msg__date">{formatDate(msg.timestamp)}</span>
                            )}
                          </div>
                          <p className="replies-msg__text">{msg.content}</p>
                        </div>
                      );
                    })
                  )
                )}
              </div>

              {/* Reply composer */}
              <div className="replies-composer">
                <textarea
                  className="draft-textarea replies-composer__textarea"
                  placeholder="Type your reply…"
                  value={currentReplyText}
                  onChange={(e) => setReplyText((prev) => ({ ...prev, [id]: e.target.value }))}
                  disabled={isBusy}
                  rows={4}
                />
                <div className="replies-composer__actions">
                  <button
                    className="btn btn-regen"
                    onClick={() => generateReply(id)}
                    disabled={isBusy}
                  >
                    {isGenerating ? (
                      <>
                        <span className="bulk-spinner-inline" aria-hidden="true" />
                        Generating…
                      </>
                    ) : (
                      "✦ Generate Reply"
                    )}
                  </button>
                  <button
                    className="btn btn-send"
                    onClick={() => sendReply(id)}
                    disabled={isBusy || !currentReplyText.trim()}
                  >
                    {isSending ? (
                      <>
                        <span className="bulk-spinner-inline" aria-hidden="true" />
                        Sending…
                      </>
                    ) : isSent ? (
                      "Sent ✓"
                    ) : (
                      "Send Reply ▸"
                    )}
                  </button>
                </div>
              </div>

              {/* Inline Converted confirmation */}
              {confirmConvertedId === id && (
                <div className="drafts-confirm">
                  <span className="drafts-confirm__text">
                    Mark {name} as converted? This is permanent.
                  </span>
                  <div className="drafts-confirm__actions">
                    <button
                      className="btn btn-send btn--sm"
                      onClick={() => markConverted(id)}
                    >
                      Confirm
                    </button>
                    <button
                      className="btn btn-secondary btn--sm"
                      onClick={() => setConfirmConvertedId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Inline Cold confirmation */}
              {confirmColdId === id && (
                <div className="drafts-confirm">
                  <span className="drafts-confirm__text">
                    Mark {name} as cold?
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
              <div className="drafts-card__actions replies-card__actions">
                <button
                  className="btn btn-send replies-card__converted-btn"
                  onClick={() => {
                    setConfirmColdId(null);
                    setConfirmConvertedId(id === confirmConvertedId ? null : id);
                  }}
                  disabled={isBusy}
                >
                  {isMarkingConverted ? "Marking…" : "Mark as Converted ✓"}
                </button>

                <button
                  className="btn btn-delete"
                  onClick={() => {
                    setConfirmConvertedId(null);
                    setConfirmColdId(id === confirmColdId ? null : id);
                  }}
                  disabled={isBusy}
                >
                  {isMarkingCold ? "Marking…" : "Mark as Cold ✗"}
                </button>

                <button
                  className="btn btn-refresh"
                  onClick={() => updateLead(id)}
                  disabled={isBusy}
                >
                  {isUpdating ? (
                    <>
                      <span className="bulk-spinner-inline" aria-hidden="true" />
                      Updating…
                    </>
                  ) : (
                    "Update ↻"
                  )}
                </button>
              </div>

              {/* Update result indicator */}
              {updateResult && (
                <div className="replies-update-result">
                  {updateResult}
                </div>
              )}

              {/* Per-card inline error */}
              {cardError && (
                <div className="drafts-card__error">{cardError}</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Toast notification */}
      {notification && (
        <div className="tracking-toast" role="status">
          {notification}
        </div>
      )}
    </div>
  );
}
