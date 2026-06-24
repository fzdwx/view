import type { CSSProperties } from "react";

export type TerminalRunStyleInput = {
  readonly fg?: string | null;
  readonly bg?: string | null;
  readonly bold: boolean;
  readonly dim: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly inverse: boolean;
};

export type TerminalRunStyle = CSSProperties & {
  readonly "--terminal-run-fg": string;
};

export function terminalRunStyle(run: TerminalRunStyleInput): TerminalRunStyle {
  const foreground = run.fg ?? "var(--ink)";
  const background = run.bg ?? "var(--surface-0)";
  const visibleForeground = run.inverse ? background : foreground;

  return {
    "--terminal-run-fg": visibleForeground,
    color: run.inverse ? background : (run.fg ?? undefined),
    backgroundColor: run.inverse ? foreground : (run.bg ?? undefined),
    // The backend maps ANSI bold colors to bright colors. Avoid synthetic CSS
    // bold here because terminal runs are clipped to exact cell widths.
    fontStyle: run.italic ? "italic" : undefined,
    textDecoration: run.underline ? "underline" : undefined,
  };
}
