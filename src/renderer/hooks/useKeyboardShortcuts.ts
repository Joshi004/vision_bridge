import { useEffect } from "react";

interface ShortcutHandlers {
  onNavigate: (path: string) => void;
  onToggleCommandPalette: () => void;
  onToggleSidebar: () => void;
  onToggleBottomPanel: () => void;
  onOpenSettings: () => void;
  onFocusComposeInput: () => void;
  onRefresh: () => void;
  onEscape: () => void;
}

const ROUTE_MAP: Record<string, string> = {
  "1": "/",
  "2": "/drafts",
  "3": "/tracking",
  "4": "/replies",
  "5": "/closed",
  "6": "/pipeline",
};

function isTypingTarget(el: EventTarget | null): boolean {
  if (!el || !(el instanceof Element)) return false;
  const tag = (el as Element).tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      const target = e.target;

      // Escape always works
      if (e.key === "Escape" && !mod) {
        handlers.onEscape();
        return;
      }

      // Modifier shortcuts work even when typing (mod key must be held)
      if (mod) {
        switch (e.key) {
          case "k":
          case "K":
            e.preventDefault();
            handlers.onToggleCommandPalette();
            return;
          case "b":
          case "B":
            e.preventDefault();
            handlers.onToggleSidebar();
            return;
          case "j":
          case "J":
            e.preventDefault();
            handlers.onToggleBottomPanel();
            return;
          case ",":
            e.preventDefault();
            handlers.onOpenSettings();
            return;
          case "n":
          case "N":
            e.preventDefault();
            handlers.onFocusComposeInput();
            return;
          case "r":
          case "R":
            e.preventDefault();
            handlers.onRefresh();
            return;
          default:
            // Cmd/Ctrl+1-6 navigation
            if (ROUTE_MAP[e.key]) {
              e.preventDefault();
              handlers.onNavigate(ROUTE_MAP[e.key]);
              return;
            }
        }
        return;
      }

      // Non-modifier shortcuts: skip when typing
      if (isTypingTarget(target)) return;
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handlers]);
}
