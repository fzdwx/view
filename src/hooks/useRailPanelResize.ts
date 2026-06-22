import { useCallback, useLayoutEffect } from "react";
import type { RefObject } from "react";
import {
  railBottomInnerPanelMaxForElement,
  railBottomInnerPanelMin,
  railBottomPanelMaxForElement,
  railBottomPanelMin,
  railSidePanelMaxForElement,
  railSidePanelMin,
} from "../lib/workbenchPanelSizing";
import type { PanelSizes, RailPanelSizeKey } from "../lib/workbenchTypes";

interface RailPanelResizeOptions {
  readonly contentGridRef: RefObject<HTMLElement | null>;
  readonly panelSizesRef: RefObject<PanelSizes>;
  readonly hasBottomPanels: boolean;
  readonly hasLeftBottomPanel: boolean;
  readonly hasLeftTopPanel: boolean;
  readonly hasRightBottomPanel: boolean;
  readonly hasRightTopPanel: boolean;
  readonly previewRailPanelResize: (
    key: RailPanelSizeKey,
    delta: number,
    min: number,
    max: number,
  ) => void;
  readonly commitRailPanelResize: (
    key: RailPanelSizeKey,
    totalDelta: number,
    min: number,
    max: number,
  ) => void;
  readonly resizePanel: (
    key: keyof PanelSizes,
    delta: number,
    min: number,
    max: number,
  ) => void;
}

interface RailPanelResizeHandlers {
  readonly handleResizeLeftTop: (delta: number) => void;
  readonly handleResizeLeftTopEnd: (delta: number) => void;
  readonly handleResizeRightTop: (delta: number) => void;
  readonly handleResizeRightTopEnd: (delta: number) => void;
  readonly handleResizeBottom: (delta: number) => void;
  readonly handleResizeBottomEnd: (delta: number) => void;
  readonly handleResizeBottomLeft: (delta: number) => void;
  readonly handleResizeBottomLeftEnd: (delta: number) => void;
}

export function useRailPanelResize({
  contentGridRef,
  panelSizesRef,
  hasBottomPanels,
  hasLeftBottomPanel,
  hasLeftTopPanel,
  hasRightBottomPanel,
  hasRightTopPanel,
  previewRailPanelResize,
  commitRailPanelResize,
  resizePanel,
}: RailPanelResizeOptions): RailPanelResizeHandlers {
  useLayoutEffect(() => {
    const element = contentGridRef.current;
    if (!element) {
      return;
    }

    const clampRailPanelsToWorkbench = () => {
      const current = panelSizesRef.current;
      if (hasLeftTopPanel) {
        const max = railSidePanelMaxForElement(element, {
          hasOppositePanel: hasRightTopPanel,
          oppositePanelWidth: current.rightTop,
        });
        if (current.leftTop > max) {
          resizePanel("leftTop", max - current.leftTop, railSidePanelMin, max);
        }
      }

      if (hasRightTopPanel) {
        const max = railSidePanelMaxForElement(element, {
          hasOppositePanel: hasLeftTopPanel,
          oppositePanelWidth: current.leftTop,
        });
        if (current.rightTop > max) {
          resizePanel("rightTop", max - current.rightTop, railSidePanelMin, max);
        }
      }

      if (hasBottomPanels) {
        const max = railBottomPanelMaxForElement(element);
        if (current.bottom > max) {
          resizePanel("bottom", max - current.bottom, railBottomPanelMin, max);
        }
      }

      if (hasLeftBottomPanel && hasRightBottomPanel) {
        const max = railBottomInnerPanelMaxForElement(element);
        if (current.bottomLeft > max) {
          resizePanel(
            "bottomLeft",
            max - current.bottomLeft,
            railBottomInnerPanelMin,
            max,
          );
        }
      }
    };

    clampRailPanelsToWorkbench();
    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const resizeObserver = new ResizeObserver(clampRailPanelsToWorkbench);
    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, [
    contentGridRef,
    hasBottomPanels,
    hasLeftBottomPanel,
    hasLeftTopPanel,
    hasRightBottomPanel,
    hasRightTopPanel,
    panelSizesRef,
    resizePanel,
  ]);

  const handleResizeLeftTop = useCallback(
    (delta: number) => {
      previewRailPanelResize(
        "leftTop",
        delta,
        railSidePanelMin,
        railSidePanelMaxForElement(contentGridRef.current, {
          hasOppositePanel: hasRightTopPanel,
          oppositePanelWidth: panelSizesRef.current.rightTop,
        }),
      );
    },
    [contentGridRef, hasRightTopPanel, panelSizesRef, previewRailPanelResize],
  );

  const handleResizeLeftTopEnd = useCallback(
    (delta: number) => {
      commitRailPanelResize(
        "leftTop",
        delta,
        railSidePanelMin,
        railSidePanelMaxForElement(contentGridRef.current, {
          hasOppositePanel: hasRightTopPanel,
          oppositePanelWidth: panelSizesRef.current.rightTop,
        }),
      );
    },
    [commitRailPanelResize, contentGridRef, hasRightTopPanel, panelSizesRef],
  );

  const handleResizeRightTop = useCallback(
    (delta: number) => {
      previewRailPanelResize(
        "rightTop",
        -delta,
        railSidePanelMin,
        railSidePanelMaxForElement(contentGridRef.current, {
          hasOppositePanel: hasLeftTopPanel,
          oppositePanelWidth: panelSizesRef.current.leftTop,
        }),
      );
    },
    [contentGridRef, hasLeftTopPanel, panelSizesRef, previewRailPanelResize],
  );

  const handleResizeRightTopEnd = useCallback(
    (delta: number) => {
      commitRailPanelResize(
        "rightTop",
        -delta,
        railSidePanelMin,
        railSidePanelMaxForElement(contentGridRef.current, {
          hasOppositePanel: hasLeftTopPanel,
          oppositePanelWidth: panelSizesRef.current.leftTop,
        }),
      );
    },
    [commitRailPanelResize, contentGridRef, hasLeftTopPanel, panelSizesRef],
  );

  const handleResizeBottom = useCallback(
    (delta: number) => {
      previewRailPanelResize(
        "bottom",
        -delta,
        railBottomPanelMin,
        railBottomPanelMaxForElement(contentGridRef.current),
      );
    },
    [contentGridRef, previewRailPanelResize],
  );

  const handleResizeBottomEnd = useCallback(
    (delta: number) => {
      commitRailPanelResize(
        "bottom",
        -delta,
        railBottomPanelMin,
        railBottomPanelMaxForElement(contentGridRef.current),
      );
    },
    [commitRailPanelResize, contentGridRef],
  );

  const handleResizeBottomLeft = useCallback(
    (delta: number) => {
      previewRailPanelResize(
        "bottomLeft",
        delta,
        railBottomInnerPanelMin,
        railBottomInnerPanelMaxForElement(contentGridRef.current),
      );
    },
    [contentGridRef, previewRailPanelResize],
  );

  const handleResizeBottomLeftEnd = useCallback(
    (delta: number) => {
      commitRailPanelResize(
        "bottomLeft",
        delta,
        railBottomInnerPanelMin,
        railBottomInnerPanelMaxForElement(contentGridRef.current),
      );
    },
    [commitRailPanelResize, contentGridRef],
  );

  return {
    handleResizeLeftTop,
    handleResizeLeftTopEnd,
    handleResizeRightTop,
    handleResizeRightTopEnd,
    handleResizeBottom,
    handleResizeBottomEnd,
    handleResizeBottomLeft,
    handleResizeBottomLeftEnd,
  };
}
