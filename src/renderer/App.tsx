import { useState, useEffect, useCallback } from "react";
import { Routes, Route, NavLink } from "react-router-dom";
import ComposePage from "./pages/ComposePage";
import DraftsPage from "./pages/DraftsPage";
import TrackingPage from "./pages/TrackingPage";
import RepliesPage from "./pages/RepliesPage";
import ClosedPage from "./pages/ClosedPage";

export default function App() {
  const [overdueCount, setOverdueCount] = useState(0);

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
        </div>
      </header>

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
