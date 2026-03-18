import { useEffect, useState } from "react";

interface ListKeyboardNavOptions<T> {
  items: T[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onDelete?: (id: number) => void;
  onToggleCheckbox?: (id: number) => void;
  onSelectAll?: () => void;
  onSave?: (id: number) => void;
  onSend?: (id: number) => void;
  getId: (item: T) => number;
  enabled?: boolean;
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!el || !(el instanceof Element)) return false;
  const tag = (el as Element).tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

export function useListKeyboardNav<T>({
  items,
  selectedId,
  onSelect,
  onDelete,
  onToggleCheckbox,
  onSelectAll,
  onSave,
  onSend,
  getId,
  enabled = true,
}: ListKeyboardNavOptions<T>): { focusedIndex: number } {
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);

  // Sync focusedIndex when selectedId changes externally (e.g. mouse click)
  useEffect(() => {
    if (selectedId === null) {
      setFocusedIndex(-1);
      return;
    }
    const idx = items.findIndex((item) => getId(item) === selectedId);
    setFocusedIndex(idx);
  }, [selectedId, items, getId]);

  // Clamp focusedIndex when items list changes
  useEffect(() => {
    if (focusedIndex >= items.length) {
      setFocusedIndex(Math.max(0, items.length - 1));
    }
  }, [items.length, focusedIndex]);

  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (items.length === 0) return;
      const mod = e.metaKey || e.ctrlKey;
      const inInput = isTypingTarget(e.target);

      // Arrow navigation — skip if typing without modifier
      if (!mod && !inInput) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setFocusedIndex((prev) => {
            const next = prev < items.length - 1 ? prev + 1 : 0;
            onSelect(getId(items[next]));
            return next;
          });
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setFocusedIndex((prev) => {
            const next = prev > 0 ? prev - 1 : items.length - 1;
            onSelect(getId(items[next]));
            return next;
          });
          return;
        }
        if (e.key === "Enter" && focusedIndex >= 0) {
          e.preventDefault();
          onSelect(getId(items[focusedIndex]));
          return;
        }
        if ((e.key === "Delete" || e.key === "Backspace") && focusedIndex >= 0) {
          e.preventDefault();
          onDelete?.(getId(items[focusedIndex]));
          return;
        }
        if (e.key === " " && focusedIndex >= 0) {
          e.preventDefault();
          onToggleCheckbox?.(getId(items[focusedIndex]));
          return;
        }
      }

      // Modifier shortcuts — always handled
      if (mod) {
        if ((e.key === "a" || e.key === "A") && onSelectAll) {
          e.preventDefault();
          onSelectAll();
          return;
        }
        if ((e.key === "s" || e.key === "S") && onSave && focusedIndex >= 0) {
          e.preventDefault();
          onSave(getId(items[focusedIndex]));
          return;
        }
        if (e.key === "Enter" && onSend && focusedIndex >= 0) {
          e.preventDefault();
          onSend(getId(items[focusedIndex]));
          return;
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, items, focusedIndex, getId, onSelect, onDelete, onToggleCheckbox, onSelectAll, onSave, onSend]);

  return { focusedIndex };
}
