import {
  DEFAULT_TERMINAL_CELL_METRICS,
  MAX_TERMINAL_COLS,
  MAX_TERMINAL_ROWS,
  MIN_TERMINAL_COLS,
  MIN_TERMINAL_ROWS,
  type TerminalCellMetrics,
} from "./terminalTypes";

function parsePixelSize(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function snapTerminalMetricToDevicePixel(value: number | null): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  const ratio =
    Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0
      ? window.devicePixelRatio
      : 1;
  return Math.max(1 / ratio, Math.round(value * ratio) / ratio);
}

export function measureTerminalCellMetrics(element: HTMLElement): TerminalCellMetrics {
  const computed = window.getComputedStyle(element);
  const probe = document.createElement("span");
  const sample = "0".repeat(64);

  probe.textContent = sample;
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.whiteSpace = "pre";
  probe.style.padding = "0";
  probe.style.margin = "0";
  probe.style.border = "0";
  probe.style.fontFamily = computed.fontFamily;
  probe.style.fontSize = computed.fontSize;
  probe.style.fontWeight = computed.fontWeight;
  probe.style.fontStyle = computed.fontStyle;
  probe.style.lineHeight = computed.lineHeight;
  probe.style.letterSpacing = computed.letterSpacing;
  probe.style.fontVariantLigatures = "none";
  probe.style.fontKerning = "none";

  element.appendChild(probe);
  const rect = probe.getBoundingClientRect();
  probe.remove();

  const measuredWidth = snapTerminalMetricToDevicePixel(rect.width / sample.length);
  const measuredHeight = snapTerminalMetricToDevicePixel(
    parsePixelSize(computed.lineHeight) ??
      (Number.isFinite(rect.height) && rect.height > 0 ? rect.height : null),
  );

  return {
    width: measuredWidth ?? DEFAULT_TERMINAL_CELL_METRICS.width,
    height: measuredHeight ?? DEFAULT_TERMINAL_CELL_METRICS.height,
  };
}

export function sizeFromElement(
  element: HTMLElement,
  cellMetrics: TerminalCellMetrics,
): { readonly cols: number; readonly rows: number } | null {
  const rect = element.getBoundingClientRect();
  const width = Number.isFinite(rect.width) ? rect.width : 0;
  const height = Number.isFinite(rect.height) ? rect.height : 0;
  const safeCellWidth = Math.max(1, cellMetrics.width);
  const safeCellHeight = Math.max(1, cellMetrics.height);

  if (width < safeCellWidth || height < safeCellHeight) {
    return null;
  }

  return {
    cols: Math.min(
      MAX_TERMINAL_COLS,
      Math.max(MIN_TERMINAL_COLS, Math.floor(width / safeCellWidth)),
    ),
    rows: Math.min(
      MAX_TERMINAL_ROWS,
      Math.max(MIN_TERMINAL_ROWS, Math.floor(height / safeCellHeight)),
    ),
  };
}
