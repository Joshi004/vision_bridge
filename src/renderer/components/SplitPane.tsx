import { useState, useRef, useCallback, useEffect } from "react";

interface SplitPaneProps {
  left: React.ReactNode;
  right: React.ReactNode;
  defaultLeftWidth?: number;
  minLeftWidth?: number;
  maxLeftWidth?: number;
  storageKey?: string;
}

export default function SplitPane({
  left,
  right,
  defaultLeftWidth = 300,
  minLeftWidth = 180,
  maxLeftWidth = 520,
  storageKey,
}: SplitPaneProps) {
  const [leftWidth, setLeftWidth] = useState<number>(() => {
    if (storageKey) {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = parseInt(stored, 10);
        if (!isNaN(parsed)) return Math.min(Math.max(parsed, minLeftWidth), maxLeftWidth);
      }
    }
    return defaultLeftWidth;
  });

  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartX = useRef<number>(0);
  const dragStartWidth = useRef<number>(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      dragStartX.current = e.clientX;
      dragStartWidth.current = leftWidth;
    },
    [leftWidth]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return;
      const delta = e.clientX - dragStartX.current;
      const newWidth = Math.min(
        Math.max(dragStartWidth.current + delta, minLeftWidth),
        maxLeftWidth
      );
      setLeftWidth(newWidth);
    },
    [isDragging, minLeftWidth, maxLeftWidth]
  );

  const handleMouseUp = useCallback(() => {
    if (!isDragging) return;
    setIsDragging(false);
    if (storageKey) {
      localStorage.setItem(storageKey, String(leftWidth));
    }
  }, [isDragging, storageKey, leftWidth]);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  return (
    <div
      ref={containerRef}
      className="split-pane"
      style={{ userSelect: isDragging ? "none" : undefined }}
    >
      <div className="split-pane__left" style={{ width: leftWidth }}>
        {left}
      </div>
      <div
        className={`split-pane__divider${isDragging ? " split-pane__divider--dragging" : ""}`}
        onMouseDown={handleMouseDown}
        role="separator"
        aria-orientation="vertical"
      />
      <div className="split-pane__right">{right}</div>
    </div>
  );
}
