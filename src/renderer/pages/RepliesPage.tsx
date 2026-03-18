import { useState, useEffect, useCallback, useRef } from "react";
import { RefreshCw, Sparkles, Check, ChevronRight, X, MessageSquare } from "lucide-react";
import SplitPane from "../components/SplitPane";
import Toolbar, { ToolbarDivider, ToolbarSpacer } from "../components/Toolbar";
import { useListKeyboardNav } from "../hooks/useListKeyboardNav";
import { useNotification } from "../hooks/useNotifications";

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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

function messageTypeLabel(type: string): string {
  switch (type) {
    case "initial":      return "(initial outreach)";
    case "follow_up_1":  return "(follow-up 1)";
    case "follow_up_2":  return "(follow-up 2)";
    case "follow_up_3":  return "(follow-up 3)";
    case "reply_received": return "(reply)";
    default:             return "";
  }
}

interface CardQueueInfo {
  jobId: string;
  status: "queued" | "active" | "failed";
  error?: string;
}

function getLastMessage(
  lead: LeadWithProfile,
  thread: OutreachThreadMessage[] | undefined
): { text: string; timestamp: string | null } {
  if (thread && thread.length > 0) {
    const last = thread[thread.length - 1];
    return { text: last.message, timestamp: last.sent_at };
  }
  if (lead.recentMessages.length > 0) {
    const last = lead.recentMessages[lead.recentMessages.length - 1];
    return { text: last.content, timestamp: last.timestamp };
  }
  return { text: "", timestamp: null };
}

export default function RepliesPage() {
  const [leads, setLeads] = useState<LeadWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);

  // Full conversation threads per lead (cached)
  const [threads, setThreads] = useState<Record<number, OutreachThreadMessage[]>>({});

  // Per-lead reply composer text (preserved across selections)
  const [replyText, setReplyText] = useState<Record<number, string>>({});

  // Per-lead async operation locks
  const [generatingId, setGeneratingId] = useState<number | null>(null);
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [markingConvertedId, setMarkingConvertedId] = useState<number | null>(null);
  const [markingColdId, setMarkingColdId] = useState<number | null>(null);

  // Per-lead queue state for send-reply jobs
  const [queueState, setQueueState] = useState<Record<number, CardQueueInfo>>({});
  const progressHandlerRef = useRef<ReturnType<typeof window.api.queue.onProgress> | null>(null);

  // Per-lead inline errors and transient indicators
  const [cardErrors, setCardErrors] = useState<Record<number, string>>({});
  const [updateResults, setUpdateResults] = useState<Record<number, string>>({});
  const updateResultTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const [sentIds, setSentIds] = useState<Set<number>>(new Set());
  const sentTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const { notify } = useNotification();

  // Update All progress
  const [updateAllState, setUpdateAllState] = useState<{ current: number; total: number } | null>(null);
  const [updateAllResult, setUpdateAllResult] = useState<{ checked: number; newMessages: number } | null>(null);

  // Single thread scroll ref (only one conversation visible at a time)
  const threadRef = useRef<HTMLDivElement | null>(null);

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

  function scrollThreadToBottom() {
    const el = threadRef.current;
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

  // Listen for global refresh shortcut
  useEffect(() => {
    const handler = () => fetchLeads();
    window.addEventListener("visionbridge:refresh", handler);
    return () => window.removeEventListener("visionbridge:refresh", handler);
  }, [fetchLeads]);

  // Auto-scroll to bottom when thread for the selected lead updates
  useEffect(() => {
    if (selectedLeadId !== null) {
      scrollThreadToBottom();
    }
  }, [threads, selectedLeadId]);

  // Subscribe to queue progress events; sync in-flight send-reply jobs on mount
  useEffect(() => {
    window.api.queue.getStatus().then((snapshot) => {
      const replyJobs = snapshot.actionQueue.filter(
        (item) =>
          item.type === "send-reply" &&
          (item.status === "queued" || item.status === "active" || item.status === "failed")
      );
      if (replyJobs.length > 0) {
        const state: Record<number, CardQueueInfo> = {};
        for (const job of replyJobs) {
          const leadId = job.payload.leadId as number | undefined;
          if (leadId !== undefined) {
            state[leadId] = {
              jobId: job.id,
              status: job.status as CardQueueInfo["status"],
              error: job.error,
            };
          }
        }
        setQueueState(state);
      }
    });

    const handler = window.api.queue.onProgress((item) => {
      if (item.type !== "send-reply") return;
      const leadId = item.payload.leadId as number | undefined;
      if (leadId === undefined) return;

      if (item.status === "completed") {
        setQueueState((prev) => {
          const n = { ...prev };
          delete n[leadId];
          return n;
        });
        setReplyText((prev) => {
          const n = { ...prev };
          delete n[leadId];
          return n;
        });
        const messageText = item.payload.message as string | undefined;
        if (messageText) {
          const sentMsg: OutreachThreadMessage = {
            id: Date.now(),
            lead_id: leadId,
            message_type: "reply_sent",
            sender: "self",
            message: messageText,
            sent_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
          };
          setThreads((prev) => {
            const existing = prev[leadId] ?? [];
            return { ...prev, [leadId]: [...existing, sentMsg] };
          });
        }
        showSent(leadId);
        // scrollThreadToBottom is triggered by the threads useEffect above
      } else if (item.status === "cancelled") {
        setQueueState((prev) => {
          const n = { ...prev };
          delete n[leadId];
          return n;
        });
      } else if (item.status === "failed") {
        setQueueState((prev) => ({
          ...prev,
          [leadId]: { jobId: item.id, status: "failed", error: item.error },
        }));
      } else {
        setQueueState((prev) => ({
          ...prev,
          [leadId]: { jobId: item.id, status: item.status as CardQueueInfo["status"] },
        }));
      }
    });

    progressHandlerRef.current = handler;
    return () => {
      if (progressHandlerRef.current) {
        window.api.queue.removeProgressListener(progressHandlerRef.current);
        progressHandlerRef.current = null;
      }
    };
  }, [showNotification]);

  // ── Generate Reply ────────────────────────────────────────────────────────

  async function generateReply(id: number) {
    const existingText = replyText[id] ?? "";
    if (existingText.trim()) {
      const confirmed = await window.api.showConfirmDialog(
        "Overwrite Draft",
        "This will overwrite your current draft. Continue?"
      );
      if (!confirmed) return;
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

    if (queueState[id]?.status === "failed") {
      setQueueState((prev) => {
        const n = { ...prev };
        delete n[id];
        return n;
      });
    }

    setSendingId(id);
    clearCardError(id);
    try {
      const result = await window.api.sendReply(id, message.trim());
      if ("queued" in result && result.queued) {
        setQueueState((prev) => ({
          ...prev,
          [id]: { jobId: result.jobId, status: "queued" },
        }));
      } else if ("success" in result && result.success === false) {
        const errMsg = result.needsLogin
          ? "Your LinkedIn session has expired. Please log in again via the Compose page."
          : result.error;
        setCardError(id, errMsg);
      }
    } catch (err) {
      setCardError(id, err instanceof Error ? err.message : "Failed to send reply.");
    } finally {
      setSendingId(null);
    }
  }

  // ── Update (single lead) ──────────────────────────────────────────────────

  async function updateLead(id: number, silent = false) {
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
      if (!silent && newMessagesFound) {
        showUpdateResult(
          id,
          `${newMessageCount} new message${newMessageCount !== 1 ? "s" : ""} found`
        );
      }
    } catch (err) {
      setCardError(id, err instanceof Error ? err.message : "Failed to update conversation.");
    } finally {
      setUpdatingId(null);
    }
  }

  // ── Mark as Converted ────────────────────────────────────────────────────

  async function handleMarkConverted(id: number, name: string) {
    const confirmed = await window.api.showConfirmDialog(
      "Mark as Converted",
      `Mark "${name}" as Converted?`
    );
    if (confirmed) await markConverted(id);
  }

  async function markConverted(id: number) {
    setMarkingConvertedId(id);
    clearCardError(id);
    try {
      const result = await window.api.markConverted(id);
      if (!result.success) {
        setCardError(id, result.error);
        return;
      }
      setLeads((prev) => prev.filter((l) => l.id !== id));
      setSelectedLeadId(null);
      showNotification("Lead marked as Converted.");
    } catch (err) {
      setCardError(id, err instanceof Error ? err.message : "Failed to mark as converted.");
    } finally {
      setMarkingConvertedId(null);
    }
  }

  // ── Mark as Cold ─────────────────────────────────────────────────────────

  async function handleMarkCold(id: number, name: string) {
    const confirmed = await window.api.showConfirmDialog(
      "Mark as Cold",
      `Mark "${name}" as Cold?`
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
      setSelectedLeadId(null);
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

  // ── Lead selection ────────────────────────────────────────────────────────

  async function loadStoredThread(id: number) {
    setUpdatingId(id);
    try {
      const result = await window.api.getLeadThread(id);
      if ("success" in result && result.success === false) return;
      setThreads((prev) => ({ ...prev, [id]: (result as { conversationThread: OutreachThreadMessage[] }).conversationThread }));
    } catch (err) {
      console.error("Failed to load stored thread for lead", id, err);
    } finally {
      setUpdatingId(null);
    }
  }

  function handleSelectLead(id: number) {
    const newId = id === selectedLeadId ? null : id;
    setSelectedLeadId(newId);
    // Load stored messages instantly without scraping
    if (newId !== null && threads[newId] === undefined) {
      loadStoredThread(newId);
    }
  }

  // ── Keyboard navigation ───────────────────────────────────────────────────

  const { focusedIndex: kbFocusedIndex } = useListKeyboardNav({
    items: leads,
    selectedId: selectedLeadId,
    onSelect: (id) => handleSelectLead(id),
    getId: (l) => l.id,
  });

  // ── Context menu ─────────────────────────────────────────────────────────────

  async function handleContextMenu(e: React.MouseEvent, lead: LeadWithProfile) {
    e.preventDefault();
    const id = lead.id;
    const name = lead.profile.name ?? "LinkedIn Profile";

    const action = await window.api.showContextMenu([
      { id: 'reply', label: 'Reply', enabled: true },
      { id: 'mark-converted', label: 'Mark Converted', enabled: true },
      { id: 'mark-cold', label: 'Mark Cold', enabled: true },
      { id: 'sep1', label: '', type: 'separator' },
      { id: 'open-linkedin', label: 'Open LinkedIn Profile', enabled: !!lead.profile.linkedin_url },
      { id: 'copy-url', label: 'Copy Profile URL', enabled: !!lead.profile.linkedin_url },
    ]);

    if (!action) return;
    switch (action) {
      case 'reply':
        handleSelectLead(id);
        break;
      case 'mark-converted':
        await handleMarkConverted(id, name);
        break;
      case 'mark-cold':
        await handleMarkCold(id, name);
        break;
      case 'open-linkedin':
        window.open(lead.profile.linkedin_url, '_blank', 'noopener,noreferrer');
        break;
      case 'copy-url':
        await navigator.clipboard.writeText(lead.profile.linkedin_url);
        break;
    }
  }

  // ── Derived state ─────────────────────────────────────────────────────────

  const selectedLead = leads.find((l) => l.id === selectedLeadId) ?? null;
  const isUpdateAllRunning = updateAllState !== null;

  // ── Loading / error ───────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="replies-layout">
        <div className="drafts-loading">
          <span className="bulk-spinner" aria-hidden="true" />
          Loading replies…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="replies-layout">
        <div className="drafts-error">
          <p>{error}</p>
          <button className="btn btn-secondary" onClick={fetchLeads}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ── Left pane: lead list ──────────────────────────────────────────────────

  const leadList = (
    <div className="replies-list">
      {leads.length === 0 ? (
        <div className="drafts-list__empty">
          <p>No replies yet.</p>
          <p className="drafts-list__empty-hint">
            Replies will appear here when contacts respond to your outreach.
          </p>
        </div>
      ) : (
        leads.map((lead, listIdx) => {
          const id = lead.id;
          const name = lead.profile.name ?? "LinkedIn Profile";
          const isSelected = selectedLeadId === id;
          const isKeyboardFocused = listIdx === kbFocusedIndex;
          const lastMsg = getLastMessage(lead, threads[id]);
          const snippet =
            lastMsg.text
              ? lastMsg.text.slice(0, 65) + (lastMsg.text.length > 65 ? "…" : "")
              : "";
          // Show unread dot while thread hasn't been loaded yet
          const hasUnread = threads[id] === undefined;

          return (
            <div
              key={id}
              className={`replies-list-row${isSelected ? " replies-list-row--active" : ""}${isKeyboardFocused ? " replies-list-row--keyboard-focused" : ""}`}
              onClick={() => handleSelectLead(id)}
              onDoubleClick={() => handleSelectLead(id)}
              onContextMenu={(e) => handleContextMenu(e, lead)}
            >
              {hasUnread && (
                <span className="replies-list-row__unread" aria-label="Not yet loaded" />
              )}
              <div className="replies-list-row__info">
                <span className="replies-list-row__name">{name}</span>
                {snippet && (
                  <span className="replies-list-row__snippet">{snippet}</span>
                )}
                {lastMsg.timestamp && (
                  <span className="replies-list-row__date">{formatDate(lastMsg.timestamp)}</span>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );

  // ── Right pane: detail panel ──────────────────────────────────────────────

  let detailPanel: React.ReactNode;

  if (!selectedLead) {
    detailPanel = (
      <div className="replies-empty-detail">
        <MessageSquare size={28} />
        <p>Select a conversation from the list</p>
      </div>
    );
  } else {
    const id = selectedLead.id;
    const name = selectedLead.profile.name ?? "LinkedIn Profile";
    const cardError = cardErrors[id];
    const isGenerating = generatingId === id;
    const isUpdating = updatingId === id;
    const isMarkingConverted = markingConvertedId === id;
    const isMarkingCold = markingColdId === id;
    const cardQueueInfo = queueState[id];
    const isQueued = cardQueueInfo?.status === "queued";
    const isActivelySending = cardQueueInfo?.status === "active" || sendingId === id;
    const isInQueue = isQueued || isActivelySending;
    const isQueueFailed = cardQueueInfo?.status === "failed";
    const isBusy =
      isGenerating || isInQueue || isUpdating || isMarkingConverted || isMarkingCold || isUpdateAllRunning;
    const isSent = sentIds.has(id);
    const updateResult = updateResults[id];
    const fullThread = threads[id];
    const currentReplyText = replyText[id] ?? "";

    detailPanel = (
      <div className="replies-detail">
        {/* Actions toolbar */}
        <Toolbar>
          <div className="replies-detail__profile-info">
            <a
              href={selectedLead.profile.linkedin_url}
              target="_blank"
              rel="noopener noreferrer"
              className="replies-detail__name person-link"
            >
              {name}
            </a>
            {(selectedLead.role || selectedLead.company) && (
              <span className="replies-detail__role">
                {[selectedLead.role, selectedLead.company].filter(Boolean).join(" · ")}
              </span>
            )}
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

          <ToolbarSpacer />

          {updateResult && (
            <span className="replies-update-result">{updateResult}</span>
          )}

          <button
            className="btn btn-secondary btn--sm"
            onClick={() => updateLead(id)}
            disabled={isBusy}
            title="Re-check for new messages"
          >
            {isUpdating ? (
              <>
                <span className="bulk-spinner-inline" aria-hidden="true" />
                {" "}Updating…
              </>
            ) : (
              <span className="btn-icon">
                <RefreshCw size={13} /> Update
              </span>
            )}
          </button>

          <ToolbarDivider />

          <button
            className="btn btn-send replies-card__converted-btn btn--sm"
            onClick={() => handleMarkConverted(id, name)}
            disabled={isBusy}
          >
            <span className="btn-icon">
              {isMarkingConverted ? "Marking…" : <><Check size={13} /> Mark Converted</>}
            </span>
          </button>
          <button
            className="btn btn-delete btn--sm"
            onClick={() => handleMarkCold(id, name)}
            disabled={isBusy}
          >
            <span className="btn-icon">
              {isMarkingCold ? "Marking…" : <><X size={13} /> Mark Cold</>}
            </span>
          </button>
        </Toolbar>

        {/* Conversation thread */}
        <div className="replies-detail__thread" ref={threadRef}>
          {isUpdating && !fullThread ? (
            <div className="replies-thread-loading">
              <span className="bulk-spinner" aria-hidden="true" />
              Loading conversation…
            </div>
          ) : fullThread ? (
            fullThread.map((msg) => {
              const isSelf = msg.sender === "self";
              const label = messageTypeLabel(msg.message_type);
              return (
                <div
                  key={msg.id}
                  className={`replies-msg replies-msg--${isSelf ? "self" : "them"}`}
                >
                  <div className="replies-msg__meta">
                    <span className="replies-msg__sender">{isSelf ? "You" : name}</span>
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
          ) : selectedLead.recentMessages.length > 0 ? (
            selectedLead.recentMessages.map((msg, i) => {
              const isSelf = msg.sender === "self";
              return (
                <div
                  key={i}
                  className={`replies-msg replies-msg--${isSelf ? "self" : "them"}`}
                >
                  <div className="replies-msg__meta">
                    <span className="replies-msg__sender">{isSelf ? "You" : name}</span>
                    {msg.timestamp && (
                      <span className="replies-msg__date">{formatDate(msg.timestamp)}</span>
                    )}
                  </div>
                  <p className="replies-msg__text">{msg.content}</p>
                </div>
              );
            })
          ) : (
            <div className="replies-thread-empty">
              No conversation history yet.
            </div>
          )}
        </div>

        {/* Reply composer */}
        <div className="replies-detail__composer">
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
                <span className="btn-icon">
                  <Sparkles size={14} /> Generate Reply
                </span>
              )}
            </button>
            <button
              className="btn btn-send"
              onClick={() => sendReply(id)}
              disabled={isBusy || !currentReplyText.trim()}
            >
              {isActivelySending ? (
                <>
                  <span className="bulk-spinner-inline" aria-hidden="true" />
                  Sending…
                </>
              ) : isQueued ? (
                "Queued"
              ) : isSent ? (
                <span className="btn-icon">
                  Sent <Check size={14} />
                </span>
              ) : (
                <span className="btn-icon">
                  Send Reply <ChevronRight size={14} />
                </span>
              )}
            </button>
          </div>

          {isQueueFailed && cardQueueInfo?.error && (
            <div className="drafts-card__error drafts-card__error--failed">
              <span>{cardQueueInfo.error}</span>
              <button
                className="btn btn-send btn--sm"
                onClick={async () => {
                  if (cardQueueInfo?.jobId) {
                    await window.api.queue.retry(cardQueueInfo.jobId);
                  }
                }}
              >
                Retry
              </button>
            </div>
          )}

          {cardError && (
            <div className="drafts-card__error">{cardError}</div>
          )}
        </div>
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────

  return (
    <div className="replies-layout">
      {/* Top toolbar */}
      <Toolbar>
        {leads.length > 0 && (
          <span className="toolbar__count">
            {leads.length} repl{leads.length !== 1 ? "ies" : "y"}
          </span>
        )}
        <ToolbarSpacer />
        {isUpdateAllRunning && (
          <span className="drafts-refresh-all-progress">
            <span className="bulk-spinner-inline" aria-hidden="true" />
            Updating {updateAllState.current} / {updateAllState.total}…
          </span>
        )}
        {!isUpdateAllRunning && updateAllResult && (
          <span className="replies-update-all-result">
            {updateAllResult.checked} checked · {updateAllResult.newMessages} new message
            {updateAllResult.newMessages !== 1 ? "s" : ""}
          </span>
        )}
        <button
          className="toolbar__btn"
          onClick={updateAll}
          disabled={isUpdateAllRunning || leads.length === 0}
          title="Re-check all replied leads for new messages"
        >
          <RefreshCw size={14} /> Update All
        </button>
      </Toolbar>

      {/* Empty state (no leads) */}
      {leads.length === 0 ? (
        <div className="drafts-empty">
          <p>No replies yet.</p>
          <p className="drafts-empty__hint">
            Replies will appear here automatically when contacts respond to your outreach.
          </p>
        </div>
      ) : (
        <SplitPane
          storageKey="replies-split-width"
          defaultLeftWidth={280}
          minLeftWidth={200}
          maxLeftWidth={420}
          left={leadList}
          right={detailPanel}
        />
      )}

    </div>
  );
}
