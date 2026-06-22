export const railSidePanelMin = 220;
export const railBottomPanelMin = 180;
export const railBottomInnerPanelMin = 260;
export const railPanelFallbackMax = 4000;
export const railBottomPanelFallbackMax = railPanelFallbackMax;

const railBottomSplitterSize = 6;
const railSideSplitterSize = 6;
const railBottomInnerSplitterSize = 10;

export interface RailSidePanelMaxInput {
  readonly containerWidth: number | null;
  readonly hasOppositePanel: boolean;
  readonly oppositePanelWidth: number;
}

export type RailSidePanelMaxOptions = Omit<
  RailSidePanelMaxInput,
  "containerWidth"
>;

export function railBottomPanelMax(containerHeight: number | null): number {
  return measuredPanelMax(
    containerHeight,
    railBottomSplitterSize,
    railBottomPanelMin,
  );
}

export function railSidePanelMax(input: RailSidePanelMaxInput): number {
  const oppositePanelWidth =
    input.hasOppositePanel && Number.isFinite(input.oppositePanelWidth)
      ? input.oppositePanelWidth
      : 0;
  const splitterWidth =
    railSideSplitterSize + (input.hasOppositePanel ? railSideSplitterSize : 0);
  return measuredPanelMax(
    input.containerWidth,
    splitterWidth + oppositePanelWidth,
    railSidePanelMin,
  );
}

export function railBottomInnerPanelMax(containerWidth: number | null): number {
  return measuredPanelMax(
    containerWidth,
    railBottomInnerSplitterSize,
    railBottomInnerPanelMin,
  );
}

export function railBottomPanelMaxForElement(element: HTMLElement | null): number {
  return railBottomPanelMax(measuredElementHeight(element));
}

export function railSidePanelMaxForElement(
  element: HTMLElement | null,
  options: RailSidePanelMaxOptions,
): number {
  return railSidePanelMax({
    ...options,
    containerWidth: measuredElementWidth(element),
  });
}

export function railBottomInnerPanelMaxForElement(
  element: HTMLElement | null,
): number {
  return railBottomInnerPanelMax(measuredElementWidth(element));
}

function measuredPanelMax(
  measuredSize: number | null,
  reservedSize: number,
  min: number,
): number {
  if (measuredSize == null || !Number.isFinite(measuredSize)) {
    return railPanelFallbackMax;
  }

  const availableSize = Math.floor(measuredSize - reservedSize);
  return Math.max(min, availableSize);
}

function measuredElementHeight(element: HTMLElement | null): number | null {
  if (!element) {
    return null;
  }

  const rect = element.getBoundingClientRect();
  return rect.height;
}

function measuredElementWidth(element: HTMLElement | null): number | null {
  if (!element) {
    return null;
  }

  const rect = element.getBoundingClientRect();
  return rect.width;
}
