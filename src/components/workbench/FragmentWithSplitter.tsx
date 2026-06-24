import type { ReactNode } from "react";
import { ResizeHandle } from "../ResizeHandle";
import type { ToolDock } from "../../lib/workbenchTypes";

export function FragmentWithSplitter({
  children,
  dock,
  index,
  panelCount,
  onResizeFirst,
  onResizeFirstEnd,
  onResizeSecond,
  onResizeSecondEnd,
}: {
  children: ReactNode;
  dock: ToolDock;
  index: number;
  panelCount: number;
  onResizeFirst(delta: number): void;
  onResizeFirstEnd(totalDelta: number): void;
  onResizeSecond(delta: number): void;
  onResizeSecondEnd(totalDelta: number): void;
}) {
  return (
    <>
      {children}
      {index < panelCount - 1 ? (
        <ResizeHandle
          axis={dock === "bottom" ? "x" : "y"}
          className={`git-panel-splitter-${index + 1}`}
          label="Resize Git panel"
          onResize={index === 0 ? onResizeFirst : onResizeSecond}
          onResizeEnd={index === 0 ? onResizeFirstEnd : onResizeSecondEnd}
        />
      ) : null}
    </>
  );
}
