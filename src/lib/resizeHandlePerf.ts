import type { PerfLogFields } from "./performanceLog";

export interface ResizeSessionPerfInput {
  readonly axis: "x" | "y";
  readonly className: string;
  readonly label: string;
  readonly commitMs: number;
  readonly frames: number;
  readonly totalDelta: number;
  readonly totalFlushMs: number;
  readonly maxRafWaitMs: number;
}

export function resizeSessionPerfFields({
  axis,
  className,
  label,
  commitMs,
  frames,
  totalDelta,
  totalFlushMs,
  maxRafWaitMs,
}: ResizeSessionPerfInput): PerfLogFields {
  return {
    axis,
    commitMs: roundPerfMs(commitMs),
    frames,
    handleClassName: className,
    label,
    mode: "live",
    totalDelta,
    avgFlushMs: roundPerfMs(frames > 0 ? totalFlushMs / frames : 0),
    maxRafWaitMs: roundPerfMs(maxRafWaitMs),
  };
}

function roundPerfMs(value: number): number {
  return Math.round(value * 10) / 10;
}
