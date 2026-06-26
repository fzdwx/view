export interface EditorSymbolToken {
  readonly symbol: string;
  readonly from: number;
  readonly to: number;
}

const IDENTIFIER_PATTERN = /[$A-Z_a-z][$0-9A-Z_a-z]*/g;

export function symbolTokenAtLine(
  lineText: string,
  lineFrom: number,
  position: number,
): EditorSymbolToken | null {
  const column = Math.max(0, Math.min(lineText.length, position - lineFrom));
  IDENTIFIER_PATTERN.lastIndex = 0;

  for (;;) {
    const match = IDENTIFIER_PATTERN.exec(lineText);
    if (!match) {
      return null;
    }

    const start = match.index;
    const end = start + match[0].length;
    if (column >= start && column < end) {
      return {
        symbol: match[0],
        from: lineFrom + start,
        to: lineFrom + end,
      };
    }
  }
}
