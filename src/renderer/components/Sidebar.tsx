import React from "react";
import { NavLink } from "react-router-dom";
import {
  PenLine,
  FileText,
  Radar,
  MessageSquare,
  CheckCircle2,
  GitBranch,
  Settings,
  FolderOpen,
  PanelLeftClose,
  PanelLeftOpen,
  type LucideProps,
} from "lucide-react";
import { useDroppable } from "@dnd-kit/core";

interface SidebarProps {
  overdueCount: number;
  draftsCount: number;
  repliesCount: number;
  collapsed: boolean;
  onToggle: () => void;
}

// Droppable nav targets: "closed" accepts drags from draft/tracking
// "draft" accepts drags from closed
const DROPPABLE_STAGES: Record<string, string> = {
  "/drafts": "draft",
  "/closed": "closed",
};

interface DroppableNavItemProps {
  to: string;
  icon: React.ComponentType<LucideProps>;
  label: string;
  end?: boolean;
  collapsed: boolean;
  badge?: React.ReactNode;
}

function DroppableNavItem({ to, icon: Icon, label, end, collapsed, badge }: DroppableNavItemProps) {
  const stageId = DROPPABLE_STAGES[to];
  const { isOver, setNodeRef } = useDroppable({ id: stageId ?? `nav-${to}` });
  const showDropHighlight = Boolean(stageId) && isOver;

  return (
    <NavLink
      ref={setNodeRef}
      to={to}
      end={end}
      className={({ isActive }) =>
        `sidebar__nav-item${isActive ? " sidebar__nav-item--active" : ""}${showDropHighlight ? " sidebar__nav-item--drop-target" : ""}`
      }
      title={collapsed ? label : undefined}
    >
      <Icon size={18} className="sidebar__nav-icon" />
      {!collapsed && <span className="sidebar__nav-label">{label}</span>}
      {badge}
    </NavLink>
  );
}

const navItems = [
  { to: "/", icon: PenLine, label: "Compose", end: true },
  { to: "/drafts", icon: FileText, label: "Drafts" },
  { to: "/tracking", icon: Radar, label: "Tracking" },
  { to: "/replies", icon: MessageSquare, label: "Replies" },
  { to: "/closed", icon: CheckCircle2, label: "Closed" },
  { to: "/pipeline", icon: GitBranch, label: "Pipeline" },
];

export default function Sidebar({ overdueCount, draftsCount, repliesCount, collapsed, onToggle }: SidebarProps) {
  return (
    <aside className={`sidebar${collapsed ? " sidebar--collapsed" : ""}`}>
      <div className="sidebar__brand">
        <span className="sidebar__brand-icon">V</span>
        {!collapsed && <span className="sidebar__brand-name">Vision</span>}
      </div>

      <div className="sidebar__divider" />

      <nav className="sidebar__nav">
        {navItems.map(({ to, icon, label, end }) => {
          const trackingCount = label === "Tracking" ? overdueCount : 0;
          const drafts = label === "Drafts" ? draftsCount : 0;
          const replies = label === "Replies" ? repliesCount : 0;
          const count = trackingCount || drafts || replies;

          const badge = !collapsed && count > 0 ? (
            <span className="sidebar__badge">{count}</span>
          ) : collapsed && count > 0 ? (
            <span className="sidebar__badge sidebar__badge--dot" />
          ) : null;

          return (
            <DroppableNavItem
              key={to}
              to={to}
              icon={icon}
              label={label}
              end={end}
              collapsed={collapsed}
              badge={badge}
            />
          );
        })}
      </nav>

      <div className="sidebar__bottom">
        <div className="sidebar__divider" />

        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `sidebar__nav-item${isActive ? " sidebar__nav-item--active" : ""}`
          }
          title={collapsed ? "Settings" : undefined}
        >
          <Settings size={18} className="sidebar__nav-icon" />
          {!collapsed && <span className="sidebar__nav-label">Settings</span>}
        </NavLink>

        <button
          className="sidebar__nav-item sidebar__nav-item--button"
          onClick={() => window.api.openLogsFolder()}
          title={collapsed ? "Open Logs" : undefined}
        >
          <FolderOpen size={18} className="sidebar__nav-icon" />
          {!collapsed && <span className="sidebar__nav-label">Open Logs</span>}
        </button>

        <div className="sidebar__divider" />

        <button
          className="sidebar__nav-item sidebar__nav-item--button sidebar__collapse-toggle"
          onClick={onToggle}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <PanelLeftOpen size={18} className="sidebar__nav-icon" />
          ) : (
            <PanelLeftClose size={18} className="sidebar__nav-icon" />
          )}
          {!collapsed && (
            <span className="sidebar__nav-label">Collapse</span>
          )}
        </button>
      </div>
    </aside>
  );
}
