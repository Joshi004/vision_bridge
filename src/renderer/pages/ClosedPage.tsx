import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";

type FilterType = "all" | "converted" | "cold";

// ── Date helpers ─────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatDuration(startIso: string, endIso: string): string {
  const diffMs = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (diffMs <= 0) return "0 days";
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days < 30) return `${days} day${days !== 1 ? "s" : ""}`;
  const months = Math.floor(days / 30);
  const remainingDays = days % 30;
  if (remainingDays === 0) return `${months} month${months !== 1 ? "s" : ""}`;
  return `${months} month${months !== 1 ? "s" : ""}, ${remainingDays} day${remainingDays !== 1 ? "s" : ""}`;
}

// ── Sorting ───────────────────────────────────────────────────────────────────

function sortByClosed(leads: LeadWithProfile[]): LeadWithProfile[] {
  return [...leads].sort((a, b) => {
    if (!a.closed_at && !b.closed_at) return 0;
    if (!a.closed_at) return 1;
    if (!b.closed_at) return -1;
    return new Date(b.closed_at).getTime() - new Date(a.closed_at).getTime();
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ClosedPage() {
  const navigate = useNavigate();

  const [leads, setLeads] = useState<LeadWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filter, setFilter] = useState<FilterType>("all");

  const [reopeningId, setReopeningId] = useState<number | null>(null);
  const [confirmReopenId, setConfirmReopenId] = useState<number | null>(null);
  const [cardErrors, setCardErrors] = useState<Record<number, string>>({});

  const [notification, setNotification] = useState<string | null>(null);
  const [notifWithDraftsLink, setNotifWithDraftsLink] = useState(false);
  const notifTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Data fetching ─────────────────────────────────────────────────────────

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [converted, cold] = await Promise.all([
        window.api.getLeadsByStage("converted"),
        window.api.getLeadsByStage("cold"),
      ]);
      setLeads(sortByClosed([...converted, ...cold]));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load closed leads.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  // ── Notification ──────────────────────────────────────────────────────────

  function showNotification(msg: string, withDraftsLink = false) {
    if (notifTimerRef.current) clearTimeout(notifTimerRef.current);
    setNotification(msg);
    setNotifWithDraftsLink(withDraftsLink);
    notifTimerRef.current = setTimeout(() => {
      setNotification(null);
      setNotifWithDraftsLink(false);
    }, 3500);
  }

  // ── Reopen flow ───────────────────────────────────────────────────────────

  async function reopenLead(id: number) {
    setConfirmReopenId(null);
    setReopeningId(id);
    setCardErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    try {
      const result = await window.api.reopenLead(id);
      if (!result.success) {
        setCardErrors((prev) => ({
          ...prev,
          [id]: result.error ?? "Failed to reopen lead.",
        }));
        return;
      }
      setLeads((prev) => prev.filter((l) => l.id !== id));
      showNotification("Moved to Drafts. A re-engagement message has been generated.", true);
    } catch (err) {
      setCardErrors((prev) => ({
        ...prev,
        [id]: err instanceof Error ? err.message : "Failed to reopen lead.",
      }));
    } finally {
      setReopeningId(null);
    }
  }

  // ── Derived counts + filtered list ────────────────────────────────────────

  const convertedLeads = leads.filter((l) => l.stage === "converted");
  const coldLeads = leads.filter((l) => l.stage === "cold");

  const filteredLeads =
    filter === "converted"
      ? convertedLeads
      : filter === "cold"
      ? coldLeads
      : leads;

  // ── Loading / error states ────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="container">
        <div className="drafts-loading">
          <span className="bulk-spinner" />
          Loading closed leads…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container">
        <div className="drafts-error">
          <span>{error}</span>
          <button className="btn btn-secondary btn--sm" onClick={fetchLeads}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="container">
      {/* Page header */}
      <div className="closed-header">
        <h1 className="closed-title">
          Closed
          <span className="drafts-count-badge">{leads.length}</span>
        </h1>

        {/* Toggle filter bar */}
        {leads.length > 0 && (
          <div className="closed-toggle-bar" role="group" aria-label="Filter closed leads">
            <button
              className={`closed-toggle-btn${filter === "all" ? " closed-toggle-btn--active" : ""}`}
              onClick={() => setFilter("all")}
            >
              All <span className="closed-toggle-count">({leads.length})</span>
            </button>
            <button
              className={`closed-toggle-btn${filter === "converted" ? " closed-toggle-btn--active" : ""}`}
              onClick={() => setFilter("converted")}
            >
              Converted <span className="closed-toggle-count">({convertedLeads.length})</span>
            </button>
            <button
              className={`closed-toggle-btn${filter === "cold" ? " closed-toggle-btn--active" : ""}`}
              onClick={() => setFilter("cold")}
            >
              Cold <span className="closed-toggle-count">({coldLeads.length})</span>
            </button>
          </div>
        )}
      </div>

      {/* Empty states */}
      {leads.length === 0 && (
        <div className="closed-empty">
          <p className="closed-empty__text">
            No closed leads yet. Leads appear here when they are marked as Converted or Cold.
          </p>
        </div>
      )}

      {leads.length > 0 && filteredLeads.length === 0 && (
        <div className="closed-empty">
          <p className="closed-empty__text">
            {filter === "converted" ? "No converted leads yet." : "No cold leads yet."}
          </p>
        </div>
      )}

      {/* Lead cards */}
      {filteredLeads.length > 0 && (
        <div className="drafts-card-list">
          {filteredLeads.map((lead) => {
            const id = lead.id;
            const name = lead.profile.name ?? "Unknown";
            const role = lead.role ?? lead.profile.headline ?? "—";
            const company = lead.company ?? "—";
            const isConverted = lead.stage === "converted";
            const startDate = lead.initial_sent_at ?? lead.created_at;
            const endDate = lead.closed_at;
            const isReopening = reopeningId === id;
            const isConfirming = confirmReopenId === id;
            const cardError = cardErrors[id];

            return (
              <div key={id} className={`drafts-card closed-card${isReopening ? " closed-card--processing" : ""}`}>
                <div className="closed-card__header">
                  {/* Identity */}
                  <div className="closed-card__identity">
                    <span className="drafts-card__name">{name}</span>
                    <span className="drafts-card__role">
                      {role}
                      {role !== "—" && company !== "—" && " · "}
                      {company !== "—" && company}
                    </span>
                  </div>

                  {/* Outcome badge */}
                  <span
                    className={`closed-card__badge ${
                      isConverted ? "closed-card__badge--converted" : "closed-card__badge--cold"
                    }`}
                  >
                    {isConverted ? "Converted ✓" : "Cold ✗"}
                  </span>
                </div>

                {/* Timeline */}
                <div className="closed-card__timeline">
                  {isConverted ? (
                    <>
                      <span className="closed-card__timeline-label">Initial contact:</span>{" "}
                      <span className="closed-card__timeline-date">{formatDate(startDate)}</span>
                      {endDate && (
                        <>
                          {" → "}
                          <span className="closed-card__timeline-label">Converted:</span>{" "}
                          <span className="closed-card__timeline-date">{formatDate(endDate)}</span>
                          <span className="closed-card__timeline-duration">
                            ({formatDuration(startDate, endDate)})
                          </span>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="closed-card__timeline-label">Initial contact:</span>{" "}
                      <span className="closed-card__timeline-date">{formatDate(startDate)}</span>
                      {endDate && (
                        <>
                          {" → "}
                          <span className="closed-card__timeline-label">Went cold:</span>{" "}
                          <span className="closed-card__timeline-date">{formatDate(endDate)}</span>
                          <span className="closed-card__timeline-duration">
                            ({formatDuration(startDate, endDate)},{" "}
                            {lead.follow_up_count} follow-up{lead.follow_up_count !== 1 ? "s" : ""})
                          </span>
                        </>
                      )}
                    </>
                  )}
                </div>

                {/* Cold-only: follow-up count + reopen */}
                {!isConverted && (
                  <div className="closed-card__actions">
                    <span className="closed-card__follow-ups">
                      {lead.follow_up_count} follow-up{lead.follow_up_count !== 1 ? "s" : ""} sent
                    </span>

                    {!isConfirming && !isReopening && (
                      <button
                        className="btn btn--sm btn-reopen"
                        onClick={() => setConfirmReopenId(id)}
                        disabled={isReopening}
                      >
                        Reopen → Draft
                      </button>
                    )}

                    {isReopening && (
                      <span className="closed-card__reopening">
                        <span className="bulk-spinner-inline" />
                        Reopening…
                      </span>
                    )}
                  </div>
                )}

                {/* Inline reopen confirmation */}
                {isConfirming && (
                  <div className="drafts-confirm">
                    <span className="drafts-confirm__text">
                      Reopen {name}? Their profile will be re-scraped and a new re-engagement
                      draft will be generated.
                    </span>
                    <div className="drafts-confirm__actions">
                      <button
                        className="btn btn-primary btn--sm"
                        onClick={() => reopenLead(id)}
                      >
                        Confirm
                      </button>
                      <button
                        className="btn btn-secondary btn--sm"
                        onClick={() => setConfirmReopenId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Per-card error */}
                {cardError && (
                  <div className="drafts-card__error">
                    Failed to reopen: {cardError}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Toast notification */}
      {notification && (
        <div className={`tracking-toast${notifWithDraftsLink ? " tracking-toast--interactive" : ""}`} role="status">
          {notification}
          {notifWithDraftsLink && (
            <button
              className="closed-toast-link"
              onClick={() => {
                setNotification(null);
                navigate("/drafts");
              }}
            >
              Go to Drafts →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
