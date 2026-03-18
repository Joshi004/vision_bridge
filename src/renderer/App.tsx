import React, { useState, useEffect, useCallback } from "react";
import { Routes, Route, useNavigate, useLocation } from "react-router-dom";
import ComposePage from "./pages/ComposePage";
import DraftsPage from "./pages/DraftsPage";
import TrackingPage from "./pages/TrackingPage";
import RepliesPage from "./pages/RepliesPage";
import ClosedPage from "./pages/ClosedPage";
import SettingsPage from "./pages/SettingsPage";
import PipelinePage from "./pages/PipelinePage";
import Sidebar from "./components/Sidebar";
import StatusBar from "./components/StatusBar";
import BottomPanel, { BottomPanelContext } from "./components/BottomPanel";
import TitleBar from "./components/TitleBar";
import CommandPalette from "./components/CommandPalette";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { NotificationProvider, NotificationToast } from "./hooks/useNotifications";
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { LeadDragOverlay, type DragLeadData } from "./components/DraggableLeadRow";

type BottomPanelTab = "logs" | "queue" | "output";
export type AppTheme = "light" | "dark" | "system";

const SIDEBAR_COLLAPSED_KEY = "sidebar_collapsed";
const THEME_KEY = "app_theme";

function applyTheme(theme: AppTheme, mq?: MediaQueryList) {
  if (theme === "system") {
    const prefersDark = mq ? mq.matches : window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = prefersDark ? "dark" : "light";
  } else {
    document.documentElement.dataset.theme = theme;
  }
}

function PageTransition({ children }: { children: React.ReactNode }) {
  return <div className="page-transition">{children}</div>;
}

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [overdueCount, setOverdueCount] = useState(0);
  const [draftsCount, setDraftsCount] = useState(0);
  const [repliesCount, setRepliesCount] = useState(0);
  const [totalLeadCount, setTotalLeadCount] = useState<number | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [bottomPanelOpen, setBottomPanelOpen] = useState(false);
  const [bottomPanelTab, setBottomPanelTab] = useState<BottomPanelTab>("logs");
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  });
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [theme, setTheme] = useState<AppTheme>(() => {
    return (localStorage.getItem(THEME_KEY) as AppTheme) || "system";
  });
  const [activeDragLead, setActiveDragLead] = useState<DragLeadData | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        delay: 200,
        tolerance: 5,
      },
    })
  );

  const openPanel = useCallback((tab: BottomPanelTab = "logs") => {
    setBottomPanelTab(tab);
    setBottomPanelOpen(true);
  }, []);

  const handleThemeChange = useCallback((newTheme: AppTheme) => {
    setTheme(newTheme);
    localStorage.setItem(THEME_KEY, newTheme);
    applyTheme(newTheme);
  }, []);

  // Apply theme on mount and when system preference changes
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    applyTheme(theme, mq);
    if (theme === "system") {
      const handler = () => applyTheme("system", mq);
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
  }, [theme]);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      return next;
    });
  }, []);

  const refreshOverdueCount = useCallback(async () => {
    try {
      const result = await window.api.getOverdueCount();
      if (result.success) setOverdueCount(result.count);
    } catch {
      // Non-fatal — badge just won't update
    }
  }, []);

  const refreshTotalLeadCount = useCallback(async () => {
    try {
      const [drafts, tracking, replies, converted, cold] = await Promise.all([
        window.api.getLeadsByStage("draft"),
        window.api.getLeadsByStage("contacted"),
        window.api.getLeadsByStage("replied"),
        window.api.getLeadsByStage("converted"),
        window.api.getLeadsByStage("cold"),
      ]);
      setDraftsCount(drafts.length);
      setRepliesCount(replies.length);
      setTotalLeadCount(drafts.length + tracking.length + replies.length + converted.length + cold.length);
    } catch {
      // Non-fatal
    }
  }, []);

  useEffect(() => {
    refreshOverdueCount();
    refreshTotalLeadCount();
  }, [refreshOverdueCount, refreshTotalLeadCount]);

  // Refresh total count on global refresh events
  useEffect(() => {
    window.addEventListener("visionbridge:refresh", refreshTotalLeadCount);
    return () => window.removeEventListener("visionbridge:refresh", refreshTotalLeadCount);
  }, [refreshTotalLeadCount]);

  useEffect(() => {
    const handler = window.api.queue.onSessionExpired(() => {
      setSessionExpired(true);
    });
    return () => {
      window.api.queue.removeSessionExpiredListener(handler);
    };
  }, []);

  // Listen for menu-triggered navigation and actions from Electron
  useEffect(() => {
    const navHandler = window.api.onMenuNavigate?.((path: string) => {
      navigate(path);
    });
    const actionHandler = window.api.onMenuAction?.((action: string) => {
      switch (action) {
        case "command-palette":
          setCommandPaletteOpen((prev) => !prev);
          break;
        case "toggle-sidebar":
          toggleSidebar();
          break;
        case "toggle-panel":
          setBottomPanelOpen((prev) => !prev);
          break;
        case "refresh":
          window.dispatchEvent(new CustomEvent("visionbridge:refresh"));
          break;
        case "new-lead":
          navigate("/");
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent("visionbridge:focus-compose"));
          }, 50);
          break;
      }
    });
    return () => {
      window.api.offMenuNavigate?.(navHandler);
      window.api.offMenuAction?.(actionHandler);
    };
  }, [navigate, toggleSidebar]);

  const shortcutHandlers = {
    onNavigate: useCallback((path: string) => navigate(path), [navigate]),
    onToggleCommandPalette: useCallback(() => setCommandPaletteOpen((prev) => !prev), []),
    onToggleSidebar: toggleSidebar,
    onToggleBottomPanel: useCallback(() => setBottomPanelOpen((prev) => !prev), []),
    onOpenSettings: useCallback(() => navigate("/settings"), [navigate]),
    onFocusComposeInput: useCallback(() => {
      navigate("/");
      // Give the page time to mount, then dispatch focus event
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("visionbridge:focus-compose"));
      }, 50);
    }, [navigate]),
    onRefresh: useCallback(() => {
      window.dispatchEvent(new CustomEvent("visionbridge:refresh"));
    }, []),
    onEscape: useCallback(() => {
      if (commandPaletteOpen) {
        setCommandPaletteOpen(false);
      } else if (bottomPanelOpen) {
        setBottomPanelOpen(false);
      }
    }, [commandPaletteOpen, bottomPanelOpen]),
  };

  useKeyboardShortcuts(shortcutHandlers);

  function handleDragStart(event: DragStartEvent) {
    setActiveDragLead(event.active.data.current as DragLeadData);
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveDragLead(null);
    const { active, over } = event;
    if (!over || !active.data.current) return;

    const lead = active.data.current as DragLeadData;
    const targetStage = over.id as string;

    if (targetStage === lead.currentStage) return;

    try {
      if (targetStage === "closed" && (lead.currentStage === "draft" || lead.currentStage === "tracking")) {
        await window.api.markCold(lead.leadId);
        window.dispatchEvent(new CustomEvent("visionbridge:refresh"));
      } else if (targetStage === "draft" && lead.currentStage === "closed") {
        await window.api.reopenLead(lead.leadId);
        window.dispatchEvent(new CustomEvent("visionbridge:refresh"));
      }
    } catch {
      // Non-fatal; user can perform the action manually
    }
  }

  return (
    <NotificationProvider>
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
    <BottomPanelContext.Provider value={{ openPanel }}>
      <div className="app-root">
        <TitleBar onSearchClick={() => setCommandPaletteOpen(true)} />
        <div className="app-shell">
          <Sidebar
            overdueCount={overdueCount}
            draftsCount={draftsCount}
            repliesCount={repliesCount}
            collapsed={sidebarCollapsed}
            onToggle={toggleSidebar}
          />
          <div className="app-main">
            <main className="app-content">
              <Routes location={location} key={location.pathname}>
                <Route path="/" element={<PageTransition><ComposePage /></PageTransition>} />
                <Route path="/drafts" element={<PageTransition><DraftsPage /></PageTransition>} />
                <Route
                  path="/tracking"
                  element={<PageTransition><TrackingPage onOverdueChange={refreshOverdueCount} /></PageTransition>}
                />
                <Route path="/replies" element={<PageTransition><RepliesPage /></PageTransition>} />
                <Route path="/closed" element={<PageTransition><ClosedPage /></PageTransition>} />
                <Route path="/pipeline" element={<PageTransition><PipelinePage /></PageTransition>} />
                <Route path="/settings" element={<PageTransition><SettingsPage theme={theme} onThemeChange={handleThemeChange} /></PageTransition>} />
              </Routes>
            </main>
            <BottomPanel
              isOpen={bottomPanelOpen}
              activeTab={bottomPanelTab}
              onToggle={() => setBottomPanelOpen((prev) => !prev)}
              onTabChange={(tab) => {
                setBottomPanelTab(tab as BottomPanelTab);
                setBottomPanelOpen(true);
              }}
            />
            <StatusBar sessionExpired={sessionExpired} totalLeadCount={totalLeadCount} />
          </div>
        </div>
        <CommandPalette
          isOpen={commandPaletteOpen}
          onClose={() => setCommandPaletteOpen(false)}
          onNavigate={(path) => {
            navigate(path);
            setCommandPaletteOpen(false);
          }}
          onToggleSidebar={() => {
            toggleSidebar();
            setCommandPaletteOpen(false);
          }}
          onToggleBottomPanel={() => {
            setBottomPanelOpen((prev) => !prev);
            setCommandPaletteOpen(false);
          }}
        />
        <NotificationToast onNavigate={navigate} />
        <DragOverlay dropAnimation={null}>
          {activeDragLead ? <LeadDragOverlay leadName={activeDragLead.leadName} /> : null}
        </DragOverlay>
      </div>
    </BottomPanelContext.Provider>
    </DndContext>
    </NotificationProvider>
  );
}

