import { useState, useEffect, useRef } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { Bell, CheckCheck, Trash2, CheckCircle, AlertCircle, AlertTriangle, Info } from "lucide-react";
import { useNotification, type AppNotification, type NotificationType } from "../hooks/useNotifications";

interface StatusBarProps {
  sessionExpired: boolean;
  totalLeadCount: number | null;
}

const TYPE_ICON: Record<NotificationType, React.ReactNode> = {
  success: <CheckCircle size={12} />,
  error: <AlertCircle size={12} />,
  warning: <AlertTriangle size={12} />,
  info: <Info size={12} />,
};

const TYPE_CLASS: Record<NotificationType, string> = {
  success: "notif-item--success",
  error: "notif-item--error",
  warning: "notif-item--warning",
  info: "notif-item--info",
};

function formatRelativeTime(ts: number): string {
  const diffMs = Date.now() - ts;
  const diffS = Math.floor(diffMs / 1000);
  if (diffS < 60) return "just now";
  const diffM = Math.floor(diffS / 60);
  if (diffM < 60) return `${diffM}m ago`;
  const diffH = Math.floor(diffM / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return `${Math.floor(diffH / 24)}d ago`;
}

function NotificationDropdown({
  notifications,
  onMarkAllRead,
  onClearAll,
  onNavigate,
}: {
  notifications: AppNotification[];
  onMarkAllRead: () => void;
  onClearAll: () => void;
  onNavigate: (path: string) => void;
}) {
  return (
    <div className="notif-dropdown">
      <div className="notif-dropdown__header">
        <span className="notif-dropdown__title">Notifications</span>
        <div className="notif-dropdown__actions">
          <button
            className="notif-dropdown__action-btn"
            onClick={onMarkAllRead}
            title="Mark all read"
          >
            <CheckCheck size={13} />
          </button>
          <button
            className="notif-dropdown__action-btn"
            onClick={onClearAll}
            title="Clear all"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      <div className="notif-dropdown__list">
        {notifications.length === 0 ? (
          <div className="notif-dropdown__empty">No notifications</div>
        ) : (
          notifications.map((n) => (
            <div
              key={n.id}
              className={`notif-item ${TYPE_CLASS[n.type]}${n.read ? "" : " notif-item--unread"}`}
            >
              <span className="notif-item__icon">{TYPE_ICON[n.type]}</span>
              <div className="notif-item__body">
                <span className="notif-item__msg">{n.message}</span>
                {n.link && (
                  <button
                    className="notif-item__link"
                    onClick={() => onNavigate(n.link!.path)}
                  >
                    {n.link.label}
                  </button>
                )}
              </div>
              <span className="notif-item__time">{formatRelativeTime(n.timestamp)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function StatusBar({ sessionExpired, totalLeadCount }: StatusBarProps) {
  const navigate = useNavigate();
  const { notifications, unreadCount, markAllRead, clearAll } = useNotification();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [hasActive, setHasActive] = useState(false);
  const [failedCount, setFailedCount] = useState(0);
  const itemsRef = useRef<Map<string, QueueItemStatus>>(new Map());
  const progressHandlerRef = useRef<QueueProgressHandler | null>(null);
  const drainedHandlerRef = useRef<QueueDrainedHandler | null>(null);

  function syncState() {
    const all = [...itemsRef.current.values()];
    const pending = all.filter(
      (i) => i.status === "queued" || i.status === "active"
    );
    setHasActive(pending.some((i) => i.status === "active"));
    setFailedCount(all.filter((i) => i.status === "failed").length);
  }

  useEffect(() => {
    window.api.queue.getStatus().then((s) => {
      for (const item of [...s.dataQueue, ...s.actionQueue]) {
        itemsRef.current.set(item.id, item);
      }
      syncState();
    }).catch(() => {});

    const ph = window.api.queue.onProgress((item) => {
      itemsRef.current.set(item.id, item);
      syncState();
    });
    progressHandlerRef.current = ph;

    const dh = window.api.queue.onDrained(() => {
      for (const [id, item] of itemsRef.current) {
        if (item.status === "completed" || item.status === "cancelled") {
          itemsRef.current.delete(id);
        }
      }
      syncState();
    });
    drainedHandlerRef.current = dh;

    return () => {
      if (progressHandlerRef.current) {
        window.api.queue.removeProgressListener(progressHandlerRef.current);
        progressHandlerRef.current = null;
      }
      if (drainedHandlerRef.current) {
        window.api.queue.removeDrainedListener(drainedHandlerRef.current);
        drainedHandlerRef.current = null;
      }
    };
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!dropdownOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [dropdownOpen]);

  const sessionStatus = sessionExpired ? "expired" : "ok";

  function getPipelineText() {
    const activeCount = [...itemsRef.current.values()].filter(
      (i) => i.status === "active"
    ).length;
    const queuedCount = [...itemsRef.current.values()].filter(
      (i) => i.status === "queued"
    ).length;
    const parts: string[] = [];
    if (activeCount > 0) parts.push(`${activeCount} active`);
    if (queuedCount > 0) parts.push(`${queuedCount} queued`);
    if (failedCount > 0) parts.push(`⚠ ${failedCount} failed`);
    if (parts.length === 0) return "Pipeline: idle";
    return `Pipeline: ${parts.join(", ")}`;
  }

  return (
    <div className="status-bar">
      <div
        className={`status-bar__section status-bar__section--left${sessionExpired ? " status-bar__section--expired" : ""}`}
      >
        <NavLink to="/" className="status-bar__session-link" title={sessionExpired ? "Click to log in again" : undefined}>
          <span
            className={`status-bar__dot status-bar__dot--${sessionStatus}`}
            aria-hidden="true"
          />
          <span>
            LinkedIn:{" "}
            {sessionExpired ? (
              <span className="status-bar__expired">Session expired — click to log in</span>
            ) : (
              "Connected"
            )}
          </span>
        </NavLink>
      </div>

      <div className="status-bar__section status-bar__section--center">
        <NavLink
          to="/pipeline"
          className={`status-bar__pipeline-link${failedCount > 0 ? " status-bar__pipeline-link--failed" : ""}`}
        >
          {hasActive && (
            <span className="status-bar__pulse-dot" aria-hidden="true" />
          )}
          {getPipelineText()}
        </NavLink>
      </div>

      <div className="status-bar__section status-bar__section--right" ref={dropdownRef}>
        {totalLeadCount !== null && (
          <span className="status-bar__lead-count">
            {totalLeadCount} {totalLeadCount === 1 ? "lead" : "leads"}
          </span>
        )}
        <button
          className={`status-bar__notif-btn${dropdownOpen ? " status-bar__notif-btn--open" : ""}`}
          onClick={() => setDropdownOpen((o) => !o)}
          title="Notifications"
          aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ""}`}
        >
          <Bell size={13} />
          {unreadCount > 0 && (
            <span className="status-bar__notif-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>
          )}
        </button>
        {dropdownOpen && (
          <NotificationDropdown
            notifications={notifications}
            onMarkAllRead={markAllRead}
            onClearAll={clearAll}
            onNavigate={(path) => {
              setDropdownOpen(false);
              navigate(path);
            }}
          />
        )}
      </div>
    </div>
  );
}
