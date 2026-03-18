import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import React from "react";

export interface DragLeadData {
  leadId: number;
  leadName: string;
  currentStage: "draft" | "tracking" | "closed" | "replies";
}

interface DraggableLeadRowProps {
  leadId: number;
  leadName: string;
  currentStage: DragLeadData["currentStage"];
  className: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
  onDoubleClick?: React.MouseEventHandler<HTMLDivElement>;
  onContextMenu?: React.MouseEventHandler<HTMLDivElement>;
}

export function DraggableLeadRow({
  leadId,
  leadName,
  currentStage,
  className,
  style,
  children,
  onClick,
  onDoubleClick,
  onContextMenu,
}: DraggableLeadRowProps) {
  const data: DragLeadData = { leadId, leadName, currentStage };
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `lead-${leadId}`,
    data,
  });

  const dragStyle: React.CSSProperties = {
    ...style,
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : undefined,
    cursor: isDragging ? "grabbing" : "pointer",
  };

  return (
    <div
      ref={setNodeRef}
      className={className}
      style={dragStyle}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}

/** Ghost card shown under the cursor while dragging */
export function LeadDragOverlay({ leadName }: { leadName: string }) {
  return (
    <div className="lead-drag-overlay">
      <span className="lead-drag-overlay__name">{leadName}</span>
    </div>
  );
}
