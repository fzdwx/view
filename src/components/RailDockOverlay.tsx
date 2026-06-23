import { useState, type DragEvent } from "react";
import type { RailItemId, RailSide, RailSlot } from "../lib/workbenchTypes";

export interface RailDockOverlayProps {
  readonly draggedRailItem: RailItemId | null;
  readonly onDropRailItem: (
    item: RailItemId,
    side: "left" | "right",
    slot: RailSlot,
  ) => void;
}

type RailDockTarget = {
  readonly side: RailSide;
  readonly slot: RailSlot;
};

export function RailDockOverlay({
  draggedRailItem,
  onDropRailItem,
}: RailDockOverlayProps) {
  const [activeTarget, setActiveTarget] = useState<RailDockTarget | null>(null);

  if (!draggedRailItem) {
    return null;
  }

  function activateTarget(target: RailDockTarget) {
    setActiveTarget(target);
  }

  function dragEnterTarget(target: RailDockTarget, event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    activateTarget(target);
  }

  function dragOverTarget(target: RailDockTarget, event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    activateTarget(target);
  }

  function deactivateTarget(target: RailDockTarget, event: DragEvent<HTMLDivElement>) {
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) {
      return;
    }
    setActiveTarget((current) =>
      current && sameRailDockTarget(current, target) ? null : current,
    );
  }

  function makeDropHandler(side: RailSide, slot: RailSlot) {
    return (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setActiveTarget(null);
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
          active={sameRailDockTarget(activeTarget, { side: "left", slot: "top" })}
          onDragEnter={(event) => dragEnterTarget({ side: "left", slot: "top" }, event)}
          onDragLeave={(event) => deactivateTarget({ side: "left", slot: "top" }, event)}
          onDragOver={(event) => dragOverTarget({ side: "left", slot: "top" }, event)}
          onDrop={makeDropHandler("left", "top")}
        />
        <DockDrop
          label="Left · bottom"
          active={sameRailDockTarget(activeTarget, { side: "left", slot: "bottom" })}
          onDragEnter={(event) => dragEnterTarget({ side: "left", slot: "bottom" }, event)}
          onDragLeave={(event) => deactivateTarget({ side: "left", slot: "bottom" }, event)}
          onDragOver={(event) => dragOverTarget({ side: "left", slot: "bottom" }, event)}
          onDrop={makeDropHandler("left", "bottom")}
        />
      </div>
      <div className="rail-dock-center" data-tauri-drag-region />
      <div className="rail-dock-side rail-dock-right">
        <DockDrop
          label="Right · top"
          active={sameRailDockTarget(activeTarget, { side: "right", slot: "top" })}
          onDragEnter={(event) => dragEnterTarget({ side: "right", slot: "top" }, event)}
          onDragLeave={(event) => deactivateTarget({ side: "right", slot: "top" }, event)}
          onDragOver={(event) => dragOverTarget({ side: "right", slot: "top" }, event)}
          onDrop={makeDropHandler("right", "top")}
        />
        <DockDrop
          label="Right · bottom"
          active={sameRailDockTarget(activeTarget, { side: "right", slot: "bottom" })}
          onDragEnter={(event) => dragEnterTarget({ side: "right", slot: "bottom" }, event)}
          onDragLeave={(event) => deactivateTarget({ side: "right", slot: "bottom" }, event)}
          onDragOver={(event) => dragOverTarget({ side: "right", slot: "bottom" }, event)}
          onDrop={makeDropHandler("right", "bottom")}
        />
      </div>
    </div>
  );
}

function DockDrop({
  active,
  label,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
}: {
  active: boolean;
  label: string;
  onDragEnter(event: DragEvent<HTMLDivElement>): void;
  onDragLeave(event: DragEvent<HTMLDivElement>): void;
  onDragOver(event: DragEvent<HTMLDivElement>): void;
  onDrop(event: DragEvent<HTMLDivElement>): void;
}) {
  return (
    <div
      className={active ? "rail-dock-drop active" : "rail-dock-drop"}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <span className="rail-dock-drop-label">{label}</span>
    </div>
  );
}

function sameRailDockTarget(
  left: RailDockTarget | null,
  right: RailDockTarget,
): boolean {
  return left?.side === right.side && left.slot === right.slot;
}
