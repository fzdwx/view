import type { EditorTextMatch } from "./api";

export function nextMatchIndexAfter(
  matches: readonly EditorTextMatch[],
  offset: number,
): number {
  if (matches.length === 0) {
    return 0;
  }

  const nextIndex = matches.findIndex((match) => match.start >= offset);
  return nextIndex >= 0 ? nextIndex : 0;
}
