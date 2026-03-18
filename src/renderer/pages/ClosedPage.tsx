import { useState, useEffect, useCallback, Fragment } from "react";
import { Check, X, ArrowRight, ChevronUp, ChevronDown } from "lucide-react";
import Toolbar, { ToolbarDivider, ToolbarSpacer } from "../components/Toolbar";
import { useListKeyboardNav } from "../hooks/useListKeyboardNav";
import { useNotification } from "../hooks/useNotifications";

type FilterType = "all" | "converted" | "cold";
type SortCol = "name" | "outcome" | "initial_contact" | "closed_date" | "duration" | "follow_ups";
type SortDir = "asc" | "desc";

// ── Date helpers ─────────────────────────────────────────────────────────────

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

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function durationDays(startIso: string | null, endIso: string | null): number {
  if (!startIso || !endIso) return 0;
  const diff = new Date(endIso).getTime() - new Date(startIso).getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

function formatDuration(startIso: string | null, endIso: string | null): string {
  const days = durationDays(startIso, endIso);
  if (days === 0) return "—";
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  const rem = days % 30;
  return rem > 0 ? `${months}mo ${rem}d` : `${months}mo`;
}

// ── Sorting ───────────────────────────────────────────────────────────────────

function sortLeads(leads: LeadWithProfile[], col: SortCol, dir: SortDir): LeadWithProfile[] {
  const mult = dir === "asc" ? 1 : -1;
  return [...leads].sort((a, b) => {
    switch (col) {
      case "name":
        return (a.profile.name ?? "").localeCompare(b.profile.name ?? "") * mult;
      case "outcome":
        return (a.stage ?? "").localeCompare(b.stage ?? "") * mult;
      case "initial_contact": {
        const aT = a.initial_sent_at ? new Date(a.initial_sent_at).getTime() : 0;
        const bT = b.initial_sent_at ? new Date(b.initial_sent_at).getTime() : 0;
        return (aT - bT) * mult;
      }
      case "closed_date": {
        const aT = a.closed_at ? new Date(a.closed_at).getTime() : 0;
        const bT = b.closed_at ? new Date(b.closed_at).getTime() : 0;
        return (bT - aT) * mult;
      }
      case "duration": {
        const aDays = durationDays(a.initial_sent_at ?? a.created_at, a.closed_at);
        const bDays = durationDays(b.initial_sent_at ?? b.created_at, b.closed_at);
        return (aDays - bDays) * mult;
      }
      case "follow_ups":
        return (a.follow_up_count - b.follow_up_count) * mult;
      default:
        return 0;
    }
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ClosedPage() {
  const [leads, setLeads] = useState<LeadWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filter, setFilter] = useState<FilterType>("all");
  const [sortCol, setSortCol] = useState<SortCol>("closed_date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [focusedLeadId, setFocusedLeadId] = useState<number | null>(null);

  const [reopeningId, setReopeningId] = useState<number | null>(null);
  const [cardErrors, setCardErrors] = useState<Record<number, string>>({});

  const { notify } = useNotification();

  // ── Data fetching ─────────────────────────────────────────────────────────

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [converted, cold] = await Promise.all([
        window.api.getLeadsByStage("converted"),
        window.api.getLeadsByStage("cold"),
      ]);
      setLeads([...converted, ...cold]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load closed leads.");
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

  // ── Notification ──────────────────────────────────────────────────────────

  function showNotification(msg: string, withDraftsLink = false) {
    notify(msg, "info", withDraftsLink ? { label: "Go to Drafts", path: "/drafts" } : undefined);
  }

  // ── Reopen flow ───────────────────────────────────────────────────────────

  async function handleReopenLead(id: number, name: string) {
    const confirmed = await window.api.showConfirmDialog(
      "Reopen Lead",
      `Reopen "${name}" to Drafts?`,
      "Their profile will be re-scraped and a new re-engagement draft generated."
    );
    if (confirmed) await reopenLead(id);
  }

  async function reopenLead(id: number) {
    setReopeningId(id);
    setCardErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    try {
      const result = await window.api.reopenLead(id);
      if (!result.success) {
        setCardErrors((prev) => ({ ...prev, [id]: result.error ?? "Failed to reopen lead." }));
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

  // ── Sort toggling ─────────────────────────────────────────────────────────

  function toggleSort(col: SortCol) {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir(col === "closed_date" ? "desc" : "asc");
    }
  }

  // ── Derived data ──────────────────────────────────────────────────────────

  const convertedLeads = leads.filter((l) => l.stage === "converted");
  const coldLeads = leads.filter((l) => l.stage === "cold");

  const baseFiltered =
    filter === "converted" ? convertedLeads :
    filter === "cold"      ? coldLeads :
    leads;

  const displayedLeads = sortLeads(baseFiltered, sortCol, sortDir);

  // ── Context menu ─────────────────────────────────────────────────────────────

  async function handleContextMenu(e: React.MouseEvent, lead: LeadWithProfile) {
    e.preventDefault();
    const id = lead.id;
    const name = lead.profile.name ?? "Unknown";
    const isConverted = lead.stage === "converted";
    const isReopening = reopeningId === id;

    const action = await window.api.showContextMenu([
      ...(isConverted ? [] : [{ id: 'reopen', label: 'Reopen to Drafts', enabled: !isReopening } as ContextMenuItem]),
      { id: 'sep1', label: '', type: 'separator' as const },
      { id: 'open-linkedin', label: 'Open LinkedIn Profile', enabled: !!lead.profile.linkedin_url },
      { id: 'copy-url', label: 'Copy Profile URL', enabled: !!lead.profile.linkedin_url },
    ]);

    if (!action) return;
    switch (action) {
      case 'reopen':
        await handleReopenLead(id, name);
        break;
      case 'open-linkedin':
        window.open(lead.profile.linkedin_url, '_blank', 'noopener,noreferrer');
        break;
      case 'copy-url':
        await navigator.clipboard.writeText(lead.profile.linkedin_url);
        break;
    }
  }

  // ── Keyboard navigation ───────────────────────────────────────────────────

  const { focusedIndex: kbFocusedIndex } = useListKeyboardNav({
    items: displayedLeads,
    selectedId: focusedLeadId,
    onSelect: (id) => setFocusedLeadId((prev) => (prev === id ? null : id)),
    getId: (l) => l.id,
  });

  // Summary statistics
  const totalClosed = leads.length;
  const conversionRate = totalClosed > 0
    ? Math.round((convertedLeads.length / totalClosed) * 100)
    : 0;
  const avgDays = (() => {
    const withDuration = convertedLeads.filter((l) => l.initial_sent_at && l.closed_at);
    if (withDuration.length === 0) return null;
    const total = withDuration.reduce(
      (sum, l) => sum + durationDays(l.initial_sent_at ?? l.created_at, l.closed_at),
      0
    );
    return Math.round(total / withDuration.length);
  })();

  // ── Sort header helper ────────────────────────────────────────────────────

  function SortArrow({ col }: { col: SortCol }) {
    if (sortCol !== col) return null;
    return (
      <span className="sort-arrow">
        {sortDir === "asc" ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
      </span>
    );
  }

  // ── Loading / error states ────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="closed-layout">
        <div className="drafts-status-fill">
          <span className="bulk-spinner" />
          Loading closed leads…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="closed-layout">
        <div className="drafts-status-fill drafts-status-fill--error">
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
    <div className="closed-layout">
      {/* Toolbar */}
      <Toolbar>
        {/* Summary stats */}
        {totalClosed > 0 && (
          <>
            <span className="toolbar__stat">
              Total: <span className="toolbar__stat-value">{totalClosed}</span>
            </span>
            <span className="toolbar__stat">
              Converted: <span className="toolbar__stat-value" style={{ color: "var(--accent-success)" }}>
                {convertedLeads.length}
              </span>
            </span>
            <span className="toolbar__stat">
              Cold: <span className="toolbar__stat-value">{coldLeads.length}</span>
            </span>
            <span className="toolbar__stat">
              Rate: <span className="toolbar__stat-value">{conversionRate}%</span>
            </span>
            {avgDays !== null && (
              <span className="toolbar__stat">
                Avg. close: <span className="toolbar__stat-value">{avgDays}d</span>
              </span>
            )}
            <ToolbarDivider />
          </>
        )}

        {/* Filter: All / Converted / Cold */}
        <div className="toolbar__segment-group">
          <button
            className={`toolbar__segment-btn${filter === "all" ? " toolbar__segment-btn--active" : ""}`}
            onClick={() => setFilter("all")}
          >
            All ({totalClosed})
          </button>
          <button
            className={`toolbar__segment-btn${filter === "converted" ? " toolbar__segment-btn--active" : ""}`}
            onClick={() => setFilter("converted")}
          >
            <Check size={11} style={{ display: "inline", verticalAlign: "middle", marginRight: 3 }} />
            Converted ({convertedLeads.length})
          </button>
          <button
            className={`toolbar__segment-btn${filter === "cold" ? " toolbar__segment-btn--active" : ""}`}
            onClick={() => setFilter("cold")}
          >
            <X size={11} style={{ display: "inline", verticalAlign: "middle", marginRight: 3 }} />
            Cold ({coldLeads.length})
          </button>
        </div>

        <ToolbarSpacer />

        <span className="toolbar__count">
          {displayedLeads.length} lead{displayedLeads.length !== 1 ? "s" : ""}
        </span>
      </Toolbar>

      {/* Table */}
      <div className="data-table-wrap">
        {displayedLeads.length === 0 ? (
          <div className="data-table__empty">
            {totalClosed === 0
              ? "No closed leads yet. Leads appear here when they are marked as Converted or Cold."
              : filter === "converted"
              ? "No converted leads yet."
              : "No cold leads yet."}
          </div>
        ) : (
          <table className="data-table">
            <colgroup>
              <col style={{ minWidth: 130 }} />
              <col style={{ minWidth: 130 }} />
              <col style={{ width: 105 }} />
              <col style={{ width: 108 }} />
              <col style={{ width: 108 }} />
              <col style={{ width: 85 }} />
              <col style={{ width: 85 }} />
              <col style={{ width: 80 }} />
            </colgroup>
            <thead>
              <tr>
                <th
                  className={`data-table th--sortable${sortCol === "name" ? " th--sorted" : ""}`}
                  onClick={() => toggleSort("name")}
                >
                  Name <SortArrow col="name" />
                </th>
                <th className="data-table">Role</th>
                <th
                  className={`data-table th--sortable${sortCol === "outcome" ? " th--sorted" : ""}`}
                  onClick={() => toggleSort("outcome")}
                >
                  Outcome <SortArrow col="outcome" />
                </th>
                <th
                  className={`data-table th--sortable${sortCol === "initial_contact" ? " th--sorted" : ""}`}
                  onClick={() => toggleSort("initial_contact")}
                >
                  Initial Contact <SortArrow col="initial_contact" />
                </th>
                <th
                  className={`data-table th--sortable${sortCol === "closed_date" ? " th--sorted" : ""}`}
                  onClick={() => toggleSort("closed_date")}
                >
                  Closed Date <SortArrow col="closed_date" />
                </th>
                <th
                  className={`data-table th--sortable${sortCol === "duration" ? " th--sorted" : ""}`}
                  onClick={() => toggleSort("duration")}
                >
                  Duration <SortArrow col="duration" />
                </th>
                <th
                  className={`data-table th--sortable${sortCol === "follow_ups" ? " th--sorted" : ""}`}
                  onClick={() => toggleSort("follow_ups")}
                >
                  Follow-ups <SortArrow col="follow_ups" />
                </th>
                <th className="data-table">Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayedLeads.map((lead, listIdx) => {
                const id = lead.id;
                const name = lead.profile.name ?? "Unknown";
                const role = lead.role ?? lead.profile.headline ?? "—";
                const company = lead.company ?? "";
                const roleDisplay = [role, company].filter((s) => s && s !== "—").join(" · ") || "—";
                const isConverted = lead.stage === "converted";
                const isReopening = reopeningId === id;
                const cardError = cardErrors[id];
                const startDate = lead.initial_sent_at ?? lead.created_at;
                const isKeyboardFocused = listIdx === kbFocusedIndex;

                const rowClass = [
                  isConverted ? "data-table tbody tr--converted" : "data-table tbody tr--cold",
                  isKeyboardFocused ? "tr--keyboard-focused" : "",
                ].filter(Boolean).join(" ");

                return (
                  <Fragment key={id}>
                    <tr
                      className={rowClass}
                      style={isReopening ? { opacity: 0.55 } : undefined}
                      onContextMenu={(e) => handleContextMenu(e, lead)}
                      onDoubleClick={() => setFocusedLeadId((prev) => (prev === id ? null : id))}
                    >
                      <td title={name}>
                        <span className="data-table__name-link" style={{ cursor: "default" }}>{name}</span>
                        {lead.persona && (
                          <span
                            className={`meta-tag persona-${lead.persona} text-xxs`}
                            style={{ marginLeft: 5 }}
                          >
                            {PERSONA_LABELS[lead.persona] ?? lead.persona}
                          </span>
                        )}
                      </td>
                      <td title={roleDisplay}>{roleDisplay}</td>
                      <td>
                        {isConverted ? (
                          <span className="data-table__badge data-table__badge--converted">
                            <Check size={10} /> Converted
                          </span>
                        ) : (
                          <span className="data-table__badge data-table__badge--cold">
                            <X size={10} /> Cold
                          </span>
                        )}
                      </td>
                      <td>{formatDate(startDate)}</td>
                      <td>{formatDate(lead.closed_at)}</td>
                      <td>{formatDuration(startDate, lead.closed_at)}</td>
                      <td>{lead.follow_up_count}</td>
                      <td>
                        {!isConverted && (
                          <div className="data-table__actions">
                            {isReopening ? (
                              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                                <span className="bulk-spinner-inline" /> Reopening…
                              </span>
                            ) : (
                              <button
                                className="data-table__btn"
                                onClick={() => handleReopenLead(id, name)}
                                disabled={isReopening}
                                title="Reopen to Drafts"
                              >
                                <span className="btn-icon">Reopen <ArrowRight size={11} /></span>
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>

                    {/* Error row */}
                    {cardError && (
                      <tr className="data-table__confirm-row">
                        <td
                          colSpan={8}
                          style={{ color: "var(--accent-danger-dark)", background: "var(--accent-danger-bg)" }}
                        >
                          <div className="data-table__confirm-content">
                            <span className="data-table__confirm-text">Failed to reopen: {cardError}</span>
                            <button
                              className="data-table__btn"
                              onClick={() => setCardErrors((prev) => {
                                const n = { ...prev };
                                delete n[id];
                                return n;
                              })}
                            >
                              Dismiss
                            </button>
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

    </div>
  );
}
