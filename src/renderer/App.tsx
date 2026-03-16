import { useState, useEffect, useCallback, useRef } from "react";
import { Routes, Route, NavLink } from "react-router-dom";
import ComposePage from "./pages/ComposePage";
import DraftsPage from "./pages/DraftsPage";
import TrackingPage from "./pages/TrackingPage";
import RepliesPage from "./pages/RepliesPage";
import ClosedPage from "./pages/ClosedPage";

function QueueIndicator() {
  const [pendingCount, setPendingCount] = useState(0);
  const [hasActive, setHasActive] = useState(false);
  const itemsRef = useRef<Map<string, QueueItemStatus>>(new Map());
  const progressHandlerRef = useRef<QueueProgressHandler | null>(null);
  const drainedHandlerRef = useRef<QueueDrainedHandler | null>(null);

  function syncState() {
    const pending = [...itemsRef.current.values()].filter(
      (i) => i.status === "queued" || i.status === "active"
    );
    setPendingCount(pending.length);
    setHasActive(pending.some((i) => i.status === "active"));
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
      // Remove terminal items from the local tracking map
      for (const [id, item] of itemsRef.current) {
        if (
          item.status === "completed" ||
          item.status === "failed" ||
          item.status === "cancelled"
        ) {
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

  if (pendingCount === 0) return null;

  return (
    <div className="queue-indicator">
      {hasActive && <span className="queue-indicator__dot" aria-hidden="true" />}
      {hasActive
        ? `Processing ${pendingCount} task${pendingCount !== 1 ? "s" : ""}…`
        : `${pendingCount} task${pendingCount !== 1 ? "s" : ""} queued`}
    </div>
  );
}

export default function App() {
  const [overdueCount, setOverdueCount] = useState(0);
  const [sessionExpiredBanner, setSessionExpiredBanner] = useState(false);

  const refreshOverdueCount = useCallback(async () => {
    try {
      const result = await window.api.getOverdueCount();
      if (result.success) setOverdueCount(result.count);
    } catch {
      // Non-fatal — badge just won't update
    }
  }, []);

  useEffect(() => {
    refreshOverdueCount();
  }, [refreshOverdueCount]);

  useEffect(() => {
    const handler = window.api.queue.onSessionExpired(() => {
      setSessionExpiredBanner(true);
    });
    return () => {
      window.api.queue.removeSessionExpiredListener(handler);
    };
  }, []);

  return (
    <div>
      <header className="app-header">
        <div className="app-header-inner">
          <span className="app-logo">Vision</span>
          <nav className="app-nav">
            <NavLink to="/" end className={({ isActive }) => "nav-link" + (isActive ? " nav-link--active" : "")}>
              Compose
            </NavLink>
            <NavLink to="/drafts" className={({ isActive }) => "nav-link" + (isActive ? " nav-link--active" : "")}>
              Drafts
            </NavLink>
            <NavLink to="/tracking" className={({ isActive }) => "nav-link" + (isActive ? " nav-link--active" : "")}>
              Tracking
              {overdueCount > 0 && <span className="nav-badge">{overdueCount}</span>}
            </NavLink>
            <NavLink to="/replies" className={({ isActive }) => "nav-link" + (isActive ? " nav-link--active" : "")}>
              Replies
            </NavLink>
            <NavLink to="/closed" className={({ isActive }) => "nav-link" + (isActive ? " nav-link--active" : "")}>
              Closed
            </NavLink>
          </nav>
          <QueueIndicator />
        </div>
      </header>

      {sessionExpiredBanner && (
        <div className="session-expired-banner">
          <span>
            LinkedIn session expired — remaining tasks were cancelled. Please log in again via the{" "}
            <NavLink to="/" className="session-expired-banner__link">Compose</NavLink> page.
          </span>
          <button
            className="session-expired-banner__dismiss"
            onClick={() => setSessionExpiredBanner(false)}
          >
            Dismiss
          </button>
        </div>
      )}

      <Routes>
        <Route path="/" element={<ComposePage />} />
        <Route path="/drafts" element={<DraftsPage />} />
        <Route path="/tracking" element={<TrackingPage onOverdueChange={refreshOverdueCount} />} />
        <Route path="/replies" element={<RepliesPage />} />
        <Route path="/closed" element={<ClosedPage />} />
      </Routes>
    </div>
  );
}
