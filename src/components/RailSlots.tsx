import type { DragEvent } from "react";
import { railItemDefinitions } from "../lib/railItems";
import type { RailItemId, RailSlot } from "../lib/workbenchTypes";

export interface RailSlotProps {
  readonly draggedRailItem: RailItemId | null;
  readonly isActiveItem: (item: RailItemId) => boolean;
  readonly items: readonly RailItemId[];
  readonly slot: RailSlot;
  readonly disabled: boolean;
  readonly onSelectRailItem: (item: RailItemId, slot: RailSlot) => void;
  readonly onStartRailItemDrag: (item: RailItemId) => void;
  readonly onDropRailItem: (item: RailItemId, slot: RailSlot) => void;
}

export function RailSlotList({
  draggedRailItem,
  isActiveItem,
  items,
  slot,
  disabled,
  onSelectRailItem,
  onStartRailItemDrag,
  onDropRailItem,
}: RailSlotProps) {
  const isDragging = draggedRailItem !== null;
  const showZone = items.length > 0 || isDragging;

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (isDragging) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const item = draggedRailItem;
    if (item) {
      onDropRailItem(item, slot);
    }
  }

  if (!showZone) {
    return null;
  }

  return (
    <div
      className={
        isDragging
          ? `rail-slot rail-slot-${slot} drop-target`
          : `rail-slot rail-slot-${slot}`
      }
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {items.map((item) => (
        <RailButton
          key={item}
          item={item}
          active={isActiveItem(item)}
          disabled={disabled}
          onSelect={() => onSelectRailItem(item, slot)}
          onStartDrag={onStartRailItemDrag}
        />
      ))}
    </div>
  );
}

function RailButton({
  item,
  active,
  disabled,
  onSelect,
  onStartDrag,
}: {
  item: RailItemId;
  active: boolean;
  disabled: boolean;
  onSelect(): void;
  onStartDrag(item: RailItemId): void;
}) {
  const definition = railItemDefinitions[item];
  const Icon = definition.icon;
  return (
    <button
      className={
        active
          ? "activity-button rail-project-button active"
          : "activity-button rail-project-button"
      }
      aria-label={definition.label}
      title={definition.label}
      disabled={disabled}
      draggable
      onClick={onSelect}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-view-rail-item", item);
        onStartDrag(item);
      }}
    >
      <Icon size={18} />
    </button>
  );
}
