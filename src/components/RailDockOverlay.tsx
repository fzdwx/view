import type { DragEvent } from "react";
import type { RailItemId, RailSlot } from "../lib/workbenchTypes";

export interface RailDockOverlayProps {
  readonly draggedRailItem: RailItemId | null;
  readonly onDropRailItem: (
    item: RailItemId,
    side: "left" | "right",
    slot: RailSlot,
  ) => void;
}

export function RailDockOverlay({
  draggedRailItem,
  onDropRailItem,
}: RailDockOverlayProps) {
  if (!draggedRailItem) {
    return null;
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function makeDropHandler(side: "left" | "right", slot: RailSlot) {
    return (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (draggedRailItem) {
        onDropRailItem(draggedRailItem, side, slot);
      }
    };
  }

  return (
    <div className="rail-dock-overlay" aria-hidden="true">
      <div className="rail-dock-side rail-dock-left">
        <DockDrop
          label="Left · top"
          onDragOver={handleDragOver}
          onDrop={makeDropHandler("left", "top")}
        />
        <DockDrop
          label="Left · bottom"
          onDragOver={handleDragOver}
          onDrop={makeDropHandler("left", "bottom")}
        />
      </div>
      <div className="rail-dock-center" data-tauri-drag-region />
      <div className="rail-dock-side rail-dock-right">
        <DockDrop
          label="Right · top"
          onDragOver={handleDragOver}
          onDrop={makeDropHandler("right", "top")}
        />
        <DockDrop
          label="Right · bottom"
          onDragOver={handleDragOver}
          onDrop={makeDropHandler("right", "bottom")}
        />
      </div>
    </div>
  );
}

function DockDrop({
  label,
  onDragOver,
  onDrop,
}: {
  label: string;
  onDragOver(event: DragEvent<HTMLDivElement>): void;
  onDrop(event: DragEvent<HTMLDivElement>): void;
}) {
  return (
    <div
      className="rail-dock-drop"
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <span className="rail-dock-drop-label">{label}</span>
    </div>
  );
}
