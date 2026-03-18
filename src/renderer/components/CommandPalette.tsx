import { useState, useEffect, useRef, useCallback } from "react";
import {
  PenLine,
  FileText,
  Radar,
  MessageSquare,
  CheckCircle2,
  GitBranch,
  Settings,
  PanelBottomOpen,
  PanelLeftClose,
  FolderOpen,
  RefreshCw,
  User,
} from "lucide-react";

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (path: string) => void;
  onToggleSidebar: () => void;
  onToggleBottomPanel: () => void;
}

type ResultKind = "page" | "command" | "lead";

interface PaletteResult {
  id: string;
  kind: ResultKind;
  label: string;
  sublabel?: string;
  icon: React.ReactNode;
  action: () => void;
}

const STAGE_ROUTE: Record<string, string> = {
  draft: "/drafts",
  contacted: "/tracking",
  replied: "/replies",
  converted: "/closed",
  cold: "/closed",
};

const STAGE_LABEL: Record<string, string> = {
  draft: "Draft",
  contacted: "Tracking",
  replied: "Replies",
  converted: "Closed",
  cold: "Closed",
};

function normalizeQuery(s: string) {
  return s.toLowerCase().trim();
}

function fuzzyMatch(text: string, query: string): boolean {
  if (!query) return true;
  const t = normalizeQuery(text);
  const q = normalizeQuery(query);
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

export default function CommandPalette({
  isOpen,
  onClose,
  onNavigate,
  onToggleSidebar,
  onToggleBottomPanel,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [leads, setLeads] = useState<LeadWithProfile[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Reset and fetch leads when palette opens
  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      setActiveIndex(0);
      return;
    }
    inputRef.current?.focus();

    setLeadsLoading(true);
    const stages = ["draft", "contacted", "replied", "converted", "cold"];
    Promise.all(stages.map((s) => window.api.getLeadsByStage(s)))
      .then((results) => {
        setLeads(results.flat());
      })
      .catch(() => {
        setLeads([]);
      })
      .finally(() => {
        setLeadsLoading(false);
      });
  }, [isOpen]);

  const buildPageResults = useCallback(
    (): PaletteResult[] => [
      { id: "page-compose",  kind: "page", label: "Compose",  icon: <PenLine size={15} />,       action: () => onNavigate("/") },
      { id: "page-drafts",   kind: "page", label: "Drafts",   icon: <FileText size={15} />,      action: () => onNavigate("/drafts") },
      { id: "page-tracking", kind: "page", label: "Tracking", icon: <Radar size={15} />,         action: () => onNavigate("/tracking") },
      { id: "page-replies",  kind: "page", label: "Replies",  icon: <MessageSquare size={15} />, action: () => onNavigate("/replies") },
      { id: "page-closed",   kind: "page", label: "Closed",   icon: <CheckCircle2 size={15} />,  action: () => onNavigate("/closed") },
      { id: "page-pipeline", kind: "page", label: "Pipeline", icon: <GitBranch size={15} />,     action: () => onNavigate("/pipeline") },
      { id: "page-settings", kind: "page", label: "Settings", icon: <Settings size={15} />,      action: () => onNavigate("/settings") },
    ],
    [onNavigate]
  );

  const buildCommandResults = useCallback(
    (): PaletteResult[] => [
      { id: "cmd-toggle-sidebar", kind: "command", label: "Toggle Sidebar",       icon: <PanelLeftClose size={15} />,   action: onToggleSidebar },
      { id: "cmd-toggle-panel",   kind: "command", label: "Toggle Bottom Panel",  icon: <PanelBottomOpen size={15} />,  action: onToggleBottomPanel },
      { id: "cmd-open-logs",      kind: "command", label: "Open Logs Folder",     icon: <FolderOpen size={15} />,      action: () => { window.api.openLogsFolder(); onClose(); } },
      { id: "cmd-refresh",        kind: "command", label: "Refresh Current View", icon: <RefreshCw size={15} />,       action: () => { window.dispatchEvent(new CustomEvent("visionbridge:refresh")); onClose(); } },
    ],
    [onToggleSidebar, onToggleBottomPanel, onClose]
  );

  const buildLeadResults = useCallback(
    (): PaletteResult[] =>
      leads.map((lead) => ({
        id: `lead-${lead.id}`,
        kind: "lead" as ResultKind,
        label: lead.profile.name ?? "Unknown",
        sublabel: [lead.role, lead.company].filter(Boolean).join(" · ") || STAGE_LABEL[lead.stage],
        icon: <User size={15} />,
        action: () => onNavigate(STAGE_ROUTE[lead.stage] ?? "/"),
      })),
    [leads, onNavigate]
  );

  const allResults: PaletteResult[] = (() => {
    const pages = buildPageResults().filter((r) => fuzzyMatch(r.label, query));
    const commands = buildCommandResults().filter((r) => fuzzyMatch(r.label, query));
    const leadItems = buildLeadResults().filter(
      (r) => fuzzyMatch(r.label, query) || fuzzyMatch(r.sublabel ?? "", query)
    );
    return [...pages, ...commands, ...leadItems];
  })();

  // Clamp activeIndex when results change
  useEffect(() => {
    setActiveIndex((prev) => Math.min(prev, Math.max(0, allResults.length - 1)));
  }, [allResults.length]);

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => (prev < allResults.length - 1 ? prev + 1 : 0));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => (prev > 0 ? prev - 1 : allResults.length - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      allResults[activeIndex]?.action();
      return;
    }
  }

  if (!isOpen) return null;

  // Group results by kind for rendering section headers
  const pageResults = allResults.filter((r) => r.kind === "page");
  const commandResults = allResults.filter((r) => r.kind === "command");
  const leadResults = allResults.filter((r) => r.kind === "lead");

  function renderSection(title: string, items: PaletteResult[], startOffset: number) {
    if (items.length === 0) return null;
    return (
      <>
        <li className="command-palette__category" role="presentation">{title}</li>
        {items.map((item, i) => {
          const globalIndex = startOffset + i;
          return (
            <li
              key={item.id}
              className={`command-palette__item${globalIndex === activeIndex ? " command-palette__item--active" : ""}`}
              role="option"
              aria-selected={globalIndex === activeIndex}
              onMouseEnter={() => setActiveIndex(globalIndex)}
              onMouseDown={(e) => {
                e.preventDefault(); // prevent input blur
                item.action();
              }}
            >
              <span className="command-palette__item-icon">{item.icon}</span>
              <span className="command-palette__item-label">{item.label}</span>
              {item.sublabel && (
                <span className="command-palette__item-sublabel">{item.sublabel}</span>
              )}
              <span className={`command-palette__item-badge command-palette__item-badge--${item.kind}`}>
                {item.kind}
              </span>
            </li>
          );
        })}
      </>
    );
  }

  return (
    <div
      className="command-palette-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="command-palette"
        role="dialog"
        aria-label="Command palette"
        aria-modal="true"
      >
        <div className="command-palette__search-row">
          <input
            ref={inputRef}
            className="command-palette__input"
            type="text"
            placeholder="Search leads, pages, commands..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
            autoComplete="off"
            spellCheck={false}
            aria-autocomplete="list"
            aria-controls="command-palette-list"
            aria-activedescendant={allResults[activeIndex] ? `cp-item-${allResults[activeIndex].id}` : undefined}
          />
        </div>

        {allResults.length > 0 ? (
          <ul
            ref={listRef}
            id="command-palette-list"
            className="command-palette__results"
            role="listbox"
          >
            {renderSection("Pages", pageResults, 0)}
            {renderSection("Commands", commandResults, pageResults.length)}
            {leadsLoading && leadResults.length === 0 ? (
              <li className="command-palette__loading">Loading leads...</li>
            ) : (
              renderSection("Leads", leadResults, pageResults.length + commandResults.length)
            )}
          </ul>
        ) : (
          <div className="command-palette__empty">
            {leadsLoading ? "Loading..." : "No results found"}
          </div>
        )}
      </div>
    </div>
  );
}
