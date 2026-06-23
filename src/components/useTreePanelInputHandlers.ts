import type { FileTree } from "@pierre/trees";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
} from "react";
import { getClickedFilePath } from "./treePanelPointer";
import {
  isTreeSelectAllShortcut,
  selectTreePanelFilePaths,
} from "./treePanelSelection";

interface ValueRef<T> {
  current: T;
}

interface UseTreePanelInputHandlersOptions {
  readonly lastTreeSelectionPathRef: ValueRef<string | null>;
  readonly model: FileTree;
  readonly onSelectPathRef: ValueRef<(path: string) => void>;
  readonly selectablePathsRef: ValueRef<ReadonlySet<string>>;
  readonly selectedPathRef: ValueRef<string | null>;
  readonly treeSelectedPathsRef: ValueRef<readonly string[]>;
}

export function useTreePanelInputHandlers({
  lastTreeSelectionPathRef,
  model,
  onSelectPathRef,
  selectablePathsRef,
  selectedPathRef,
  treeSelectedPathsRef,
}: UseTreePanelInputHandlersOptions) {
  const handleTreeClickCapture = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      const clickedFile = getClickedFilePath(event);
      if (!clickedFile || !selectablePathsRef.current.has(clickedFile.path)) {
        return;
      }
      if (
        !clickedFile.selected ||
        selectedPathRef.current === clickedFile.path ||
        lastTreeSelectionPathRef.current === clickedFile.path
      ) {
        return;
      }

      const path = clickedFile.path;
      window.requestAnimationFrame(() => {
        if (
          selectedPathRef.current === path ||
          lastTreeSelectionPathRef.current === path ||
          !selectablePathsRef.current.has(path)
        ) {
          return;
        }

        onSelectPathRef.current(path);
      });
    },
    [
      lastTreeSelectionPathRef,
      onSelectPathRef,
      selectablePathsRef,
      selectedPathRef,
    ],
  );

  const handleTreeContextMenuCapture = useCallback(() => {
    treeSelectedPathsRef.current = model.getSelectedPaths();
  }, [model, treeSelectedPathsRef]);

  const handleTreeKeyDownCapture = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (
        !isTreeSelectAllShortcut({
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          defaultPrevented: event.defaultPrevented,
          isComposing: event.nativeEvent.isComposing,
          key: event.key,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
        }) ||
        isEditableTreeKeyboardTarget(event)
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      treeSelectedPathsRef.current = selectTreePanelFilePaths({
        model,
        selectablePaths: selectablePathsRef.current,
      });
    },
    [model, selectablePathsRef, treeSelectedPathsRef],
  );

  return {
    handleTreeClickCapture,
    handleTreeContextMenuCapture,
    handleTreeKeyDownCapture,
  };
}

function isEditableTreeKeyboardTarget(
  event: ReactKeyboardEvent<HTMLElement>,
): boolean {
  for (const item of event.nativeEvent.composedPath()) {
    if (
      item instanceof HTMLElement &&
      item.matches("input, textarea, [contenteditable='true']")
    ) {
      return true;
    }
  }

  return false;
}
