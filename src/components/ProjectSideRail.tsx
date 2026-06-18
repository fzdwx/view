import type {
  RailItemId,
  RailLayout,
} from "../lib/workbenchTypes";
import { RailSlotList } from "./RailSlots";

export interface ProjectSideRailProps {
  readonly draggedRailItem: RailItemId | null;
  readonly hasActiveProject: boolean;
  readonly isActiveItem: (item: RailItemId) => boolean;
  readonly railLayout: RailLayout;
  readonly onDropRailItem: (item: RailItemId, slot: "top" | "bottom") => void;
  readonly onSelectRailItem: (item: RailItemId, slot: "top" | "bottom") => void;
  readonly onStartRailItemDrag: (item: RailItemId) => void;
}

export function ProjectSideRail({
  draggedRailItem,
  hasActiveProject,
  isActiveItem,
  railLayout,
  onDropRailItem,
  onSelectRailItem,
  onStartRailItemDrag,
}: ProjectSideRailProps) {
  return (
    <aside className="project-rail project-side-rail" aria-label="Tools">
      <RailSlotList
        draggedRailItem={draggedRailItem}
        isActiveItem={isActiveItem}
        items={railLayout.right.top}
        slot="top"
        disabled={!hasActiveProject}
        onSelectRailItem={onSelectRailItem}
        onStartRailItemDrag={onStartRailItemDrag}
        onDropRailItem={onDropRailItem}
      />
      <div className="rail-spacer" />
      <RailSlotList
        draggedRailItem={draggedRailItem}
        isActiveItem={isActiveItem}
        items={railLayout.right.bottom}
        slot="bottom"
        disabled={!hasActiveProject}
        onSelectRailItem={onSelectRailItem}
        onStartRailItemDrag={onStartRailItemDrag}
        onDropRailItem={onDropRailItem}
      />
    </aside>
  );
}
