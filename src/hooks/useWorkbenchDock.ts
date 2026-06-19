import { useCallback, useEffect, useRef, useState } from "react";
import { clamp } from "../lib/numeric";
import {
  loadWorkbenchLayout,
  saveWorkbenchLayout,
} from "../lib/workbenchLayout";
import type {
  GitPanelId,
  PanelSizes,
  RailActiveItems,
  RailItemId,
  RailLayout,
  RailSide,
  RailSlot,
} from "../lib/workbenchTypes";
import { defaultWorkbenchLayout } from "../lib/workbenchTypes";

export interface WorkbenchDockController {
  readonly detachedGitPanels: GitPanelId[];
  readonly draggedGitPanel: GitPanelId | null;
  readonly gitPanelOrder: GitPanelId[];
  readonly panelSizes: PanelSizes;
  readonly railActiveItems: RailActiveItems;
  readonly railLayout: RailLayout;
  readonly draggedRailItem: RailItemId | null;
  readonly clearDockDrag: () => void;
  readonly dropRailItem: (item: RailItemId, side: RailSide, slot: RailSlot) => void;
  readonly moveGitPanel: (panel: GitPanelId, targetPanel: GitPanelId) => void;
  readonly reattachGitPanel: (panel: GitPanelId) => void;
  readonly resizePanel: (
    key: keyof PanelSizes,
    delta: number,
    min: number,
    max: number,
  ) => void;
  readonly selectRailItem: (
    side: RailSide,
    slot: RailSlot,
    item: RailItemId,
  ) => void;
  readonly startGitPanelDrag: (panel: GitPanelId) => void;
  readonly startRailItemDrag: (item: RailItemId) => void;
}

const railSides: readonly RailSide[] = ["left", "right"];
const railSlots: readonly RailSlot[] = ["top", "bottom"];
const layoutSaveDelayMs = 160;

export function useWorkbenchDock(): WorkbenchDockController {
  const [initialLayout] = useState(loadWorkbenchLayout);
  const [gitPanelOrder, setGitPanelOrder] = useState<GitPanelId[]>(
    initialLayout.gitPanelOrder,
  );
  const [detachedGitPanels, setDetachedGitPanels] = useState<GitPanelId[]>(
    initialLayout.detachedGitPanels,
  );
  const [draggedGitPanel, setDraggedGitPanel] = useState<GitPanelId | null>(null);
  const [panelSizes, setPanelSizes] = useState<PanelSizes>(
    initialLayout.panelSizes,
  );
  const [railLayout, setRailLayout] = useState<RailLayout>(
    initialLayout.railLayout,
  );
  const [railActiveItems, setRailActiveItems] = useState<RailActiveItems>(
    initialLayout.railActiveItems,
  );
  const [draggedRailItem, setDraggedRailItem] = useState<RailItemId | null>(null);
  const layoutSaveTimerRef = useRef<number | null>(null);
  const latestLayoutRef = useRef({
    ...defaultWorkbenchLayout,
    gitPanelOrder: initialLayout.gitPanelOrder,
    detachedGitPanels: initialLayout.detachedGitPanels,
    railLayout: initialLayout.railLayout,
    railActiveItems: initialLayout.railActiveItems,
    panelSizes: initialLayout.panelSizes,
  });

  const clearDockDrag = useCallback(() => {
    setDraggedGitPanel(null);
    setDraggedRailItem(null);
  }, []);

  useEffect(() => {
    const nextLayout = {
      ...defaultWorkbenchLayout,
      gitPanelOrder,
      detachedGitPanels,
      railLayout,
      railActiveItems,
      panelSizes,
    };
    latestLayoutRef.current = nextLayout;

    if (layoutSaveTimerRef.current !== null) {
      window.clearTimeout(layoutSaveTimerRef.current);
      layoutSaveTimerRef.current = null;
    }

    layoutSaveTimerRef.current = window.setTimeout(() => {
      layoutSaveTimerRef.current = null;
      saveWorkbenchLayout(nextLayout);
    }, layoutSaveDelayMs);

    return () => {
      if (layoutSaveTimerRef.current !== null) {
        window.clearTimeout(layoutSaveTimerRef.current);
        layoutSaveTimerRef.current = null;
      }
    };
  }, [
    detachedGitPanels,
    gitPanelOrder,
    panelSizes,
    railActiveItems,
    railLayout,
  ]);

  useEffect(() => {
    function flushWorkbenchLayout() {
      if (layoutSaveTimerRef.current !== null) {
        window.clearTimeout(layoutSaveTimerRef.current);
        layoutSaveTimerRef.current = null;
      }
      saveWorkbenchLayout(latestLayoutRef.current);
    }

    window.addEventListener("pagehide", flushWorkbenchLayout);
    return () => {
      window.removeEventListener("pagehide", flushWorkbenchLayout);
      flushWorkbenchLayout();
    };
  }, []);

  const clearDockDragRef = useRef(clearDockDrag);
  clearDockDragRef.current = clearDockDrag;

  useEffect(() => {
    const handler = () => clearDockDragRef.current();
    window.addEventListener("dragend", handler);
    window.addEventListener("drop", handler);
    return () => {
      window.removeEventListener("dragend", handler);
      window.removeEventListener("drop", handler);
    };
  }, []);

  const resizePanel = useCallback(
    (key: keyof PanelSizes, delta: number, min: number, max: number) => {
      setPanelSizes((current: PanelSizes) => {
        const nextSize = clamp(current[key] + delta, min, max);
        if (nextSize === current[key]) {
          return current;
        }

        return {
          ...current,
          [key]: nextSize,
        };
      });
    },
    [],
  );

  const startGitPanelDrag = useCallback((panel: GitPanelId) => {
    setDraggedGitPanel(panel);
  }, []);

  const moveGitPanel = useCallback(
    (panel: GitPanelId, targetPanel: GitPanelId) => {
      setDetachedGitPanels((current: GitPanelId[]) =>
        current.filter((item: GitPanelId) => item !== panel),
      );
      setGitPanelOrder((current: GitPanelId[]) => {
        if (panel === targetPanel) {
          return current;
        }

        const nextOrder = current.filter((item: GitPanelId) => item !== panel);
        const targetIndex = nextOrder.indexOf(targetPanel);
        if (targetIndex === -1) {
          return current;
        }

        nextOrder.splice(targetIndex, 0, panel);
        return nextOrder;
      });
      clearDockDrag();
    },
    [clearDockDrag],
  );

  const reattachGitPanel = useCallback(
    (panel: GitPanelId) => {
      setDetachedGitPanels((current: GitPanelId[]) =>
        current.filter((item: GitPanelId) => item !== panel),
      );
      clearDockDrag();
    },
    [clearDockDrag],
  );

  const startRailItemDrag = useCallback((item: RailItemId) => {
    // Rendering the overlay synchronously inside dragstart cancels the native drag.
    window.requestAnimationFrame(() => {
      setDraggedRailItem(item);
    });
  }, []);

  const selectRailItem = useCallback(
    (side: RailSide, slot: RailSlot, item: RailItemId) => {
      if (!railLayout[side][slot].includes(item)) {
        return;
      }
      setRailActiveItems((current: RailActiveItems) => ({
        ...current,
        [side]: {
          ...current[side],
          [slot]: current[side][slot] === item ? null : item,
        },
      }));
    },
    [railLayout],
  );

  const dropRailItem = useCallback(
    (item: RailItemId, side: RailSide, slot: RailSlot) => {
      setRailLayout((currentLayout: RailLayout) => {
        const nextLayout = cloneRailLayout(currentLayout);
        for (const railSide of railSides) {
          for (const railSlot of railSlots) {
            nextLayout[railSide][railSlot] = nextLayout[railSide][railSlot].filter(
              (existing) => existing !== item,
            );
          }
        }
        nextLayout[side][slot] = [...nextLayout[side][slot], item];
        setRailActiveItems((currentActiveItems: RailActiveItems) =>
          reconcileRailActiveItems(currentActiveItems, nextLayout, {
            item,
            side,
            slot,
          }),
        );
        return nextLayout;
      });
      setDraggedRailItem(null);
    },
    [],
  );

  return {
    detachedGitPanels,
    draggedGitPanel,
    gitPanelOrder,
    panelSizes,
    railActiveItems,
    railLayout,
    draggedRailItem,
    startRailItemDrag,
    selectRailItem,
    dropRailItem,
    clearDockDrag,
    moveGitPanel,
    reattachGitPanel,
    resizePanel,
    startGitPanelDrag,
  };
}

function cloneRailLayout(layout: RailLayout): RailLayout {
  return {
    left: {
      top: [...layout.left.top],
      bottom: [...layout.left.bottom],
    },
    right: {
      top: [...layout.right.top],
      bottom: [...layout.right.bottom],
    },
  };
}

function reconcileRailActiveItems(
  currentActiveItems: RailActiveItems,
  railLayout: RailLayout,
  preferred: {
    side: RailSide;
    slot: RailSlot;
    item: RailItemId;
  },
): RailActiveItems {
  const nextActiveItems: RailActiveItems = {
    left: { top: null, bottom: null },
    right: { top: null, bottom: null },
  };

  for (const side of railSides) {
    for (const slot of railSlots) {
      const itemSet = new Set(railLayout[side][slot]);
      const currentItem = currentActiveItems[side][slot];
      nextActiveItems[side][slot] =
        currentItem && itemSet.has(currentItem) ? currentItem : null;
    }
  }

  if (new Set(railLayout[preferred.side][preferred.slot]).has(preferred.item)) {
    nextActiveItems[preferred.side][preferred.slot] = preferred.item;
  }

  return nextActiveItems;
}
