import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type NotificationType = "success" | "error" | "info" | "warning";

export interface AppNotification {
  id: string;
  message: string;
  type: NotificationType;
  timestamp: number;
  link?: { label: string; path: string };
  read: boolean;
}

interface NotificationContextValue {
  notifications: AppNotification[];
  notify: (msg: string, type?: NotificationType, link?: AppNotification["link"]) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clearAll: () => void;
  unreadCount: number;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const NotificationContext = createContext<NotificationContextValue | null>(null);

const MAX_NOTIFICATIONS = 50;

// ─── Provider ─────────────────────────────────────────────────────────────────

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const notify = useCallback(
    (msg: string, type: NotificationType = "info", link?: AppNotification["link"]) => {
      const entry: AppNotification = {
        id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        message: msg,
        type,
        timestamp: Date.now(),
        link,
        read: false,
      };
      setNotifications((prev) => [entry, ...prev].slice(0, MAX_NOTIFICATIONS));
    },
    []
  );

  const markRead = useCallback((id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  // Subscribe to backend IPC events
  useEffect(() => {
    // Queue drained
    const drainedHandler = window.api.queue.onDrained(() => {
      notify("All queued jobs completed.", "success");
    });

    // Session expired
    const sessionHandler = window.api.queue.onSessionExpired(() => {
      notify(
        "LinkedIn session expired — remaining tasks were cancelled. Log in again via Compose.",
        "warning",
        { label: "Go to Compose", path: "/" }
      );
    });

    // Job failed
    const progressHandler = window.api.queue.onProgress((item: QueueItemStatus) => {
      if (item.status === "failed") {
        notify(
          `Job failed: ${item.type}${item.error ? ` — ${item.error}` : ""}`,
          "error"
        );
      }
    });

    return () => {
      window.api.queue.removeDrainedListener(drainedHandler);
      window.api.queue.removeSessionExpiredListener(sessionHandler);
      window.api.queue.removeProgressListener(progressHandler);
    };
  }, [notify]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <NotificationContext.Provider
      value={{ notifications, notify, markRead, markAllRead, clearAll, unreadCount }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useNotification() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotification must be used within NotificationProvider");
  return ctx;
}

// ─── Global Toast Renderer ────────────────────────────────────────────────────

const TYPE_COLORS: Record<NotificationType, string> = {
  success: "var(--accent-success)",
  error: "var(--accent-danger)",
  warning: "var(--accent-warning)",
  info: "var(--accent-info)",
};

export function NotificationToast({ onNavigate }: { onNavigate?: (path: string) => void }) {
  const { notifications, markRead } = useNotification();
  const [visible, setVisible] = useState<AppNotification | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastIdRef = useRef<string | null>(null);

  useEffect(() => {
    const newest = notifications.find((n) => !n.read);
    if (!newest || newest.id === lastIdRef.current) return;

    lastIdRef.current = newest.id;
    setVisible(newest);
    markRead(newest.id);

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(null), 3500);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [notifications, markRead]);

  if (!visible) return null;

  return (
    <div
      className="tracking-toast tracking-toast--interactive"
      role="status"
      style={{ color: "var(--text-inverse)" }}
    >
      <span
        style={{
          display: "inline-block",
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: TYPE_COLORS[visible.type],
          marginRight: 8,
          flexShrink: 0,
        }}
      />
      <span style={{ flex: 1 }}>{visible.message}</span>
      {visible.link && onNavigate && (
        <button
          className="closed-toast-link"
          onClick={() => {
            setVisible(null);
            onNavigate(visible.link!.path);
          }}
        >
          {visible.link.label}
        </button>
      )}
    </div>
  );
}
