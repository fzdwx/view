export type TerminalBoxSegments = {
  readonly top?: boolean;
  readonly right?: boolean;
  readonly bottom?: boolean;
  readonly left?: boolean;
};

export type TerminalBlockRect = {
  readonly top: string;
  readonly right: string;
  readonly bottom: string;
  readonly left: string;
};

const TERMINAL_BOX_SEGMENTS: Readonly<Record<string, TerminalBoxSegments>> = {
  "─": { left: true, right: true },
  "━": { left: true, right: true },
  "═": { left: true, right: true },
  "│": { top: true, bottom: true },
  "┃": { top: true, bottom: true },
  "║": { top: true, bottom: true },
  "┌": { right: true, bottom: true },
  "┍": { right: true, bottom: true },
  "┎": { right: true, bottom: true },
  "┏": { right: true, bottom: true },
  "╔": { right: true, bottom: true },
  "┐": { bottom: true, left: true },
  "┑": { bottom: true, left: true },
  "┒": { bottom: true, left: true },
  "┓": { bottom: true, left: true },
  "╗": { bottom: true, left: true },
  "└": { top: true, right: true },
  "┕": { top: true, right: true },
  "┖": { top: true, right: true },
  "┗": { top: true, right: true },
  "╚": { top: true, right: true },
  "┘": { top: true, left: true },
  "┙": { top: true, left: true },
  "┚": { top: true, left: true },
  "┛": { top: true, left: true },
  "╝": { top: true, left: true },
  "├": { top: true, right: true, bottom: true },
  "┝": { top: true, right: true, bottom: true },
  "┞": { top: true, right: true, bottom: true },
  "┟": { top: true, right: true, bottom: true },
  "┠": { top: true, right: true, bottom: true },
  "┡": { top: true, right: true, bottom: true },
  "┢": { top: true, right: true, bottom: true },
  "┣": { top: true, right: true, bottom: true },
  "╠": { top: true, right: true, bottom: true },
  "┤": { top: true, bottom: true, left: true },
  "┥": { top: true, bottom: true, left: true },
  "┦": { top: true, bottom: true, left: true },
  "┧": { top: true, bottom: true, left: true },
  "┨": { top: true, bottom: true, left: true },
  "┩": { top: true, bottom: true, left: true },
  "┪": { top: true, bottom: true, left: true },
  "┫": { top: true, bottom: true, left: true },
  "╣": { top: true, bottom: true, left: true },
  "┬": { right: true, bottom: true, left: true },
  "┭": { right: true, bottom: true, left: true },
  "┮": { right: true, bottom: true, left: true },
  "┯": { right: true, bottom: true, left: true },
  "┰": { right: true, bottom: true, left: true },
  "┱": { right: true, bottom: true, left: true },
  "┲": { right: true, bottom: true, left: true },
  "┳": { right: true, bottom: true, left: true },
  "╦": { right: true, bottom: true, left: true },
  "┴": { top: true, right: true, left: true },
  "┵": { top: true, right: true, left: true },
  "┶": { top: true, right: true, left: true },
  "┷": { top: true, right: true, left: true },
  "┸": { top: true, right: true, left: true },
  "┹": { top: true, right: true, left: true },
  "┺": { top: true, right: true, left: true },
  "┻": { top: true, right: true, left: true },
  "╩": { top: true, right: true, left: true },
  "┼": { top: true, right: true, bottom: true, left: true },
  "┽": { top: true, right: true, bottom: true, left: true },
  "┾": { top: true, right: true, bottom: true, left: true },
  "┿": { top: true, right: true, bottom: true, left: true },
  "╀": { top: true, right: true, bottom: true, left: true },
  "╁": { top: true, right: true, bottom: true, left: true },
  "╂": { top: true, right: true, bottom: true, left: true },
  "╃": { top: true, right: true, bottom: true, left: true },
  "╄": { top: true, right: true, bottom: true, left: true },
  "╅": { top: true, right: true, bottom: true, left: true },
  "╆": { top: true, right: true, bottom: true, left: true },
  "╇": { top: true, right: true, bottom: true, left: true },
  "╈": { top: true, right: true, bottom: true, left: true },
  "╉": { top: true, right: true, bottom: true, left: true },
  "╊": { top: true, right: true, bottom: true, left: true },
  "╋": { top: true, right: true, bottom: true, left: true },
  "╬": { top: true, right: true, bottom: true, left: true },
  "╭": { right: true, bottom: true },
  "╮": { bottom: true, left: true },
  "╰": { top: true, right: true },
  "╯": { top: true, left: true },
};

const TERMINAL_BLOCK_RECTS: Readonly<Record<string, readonly TerminalBlockRect[]>> = {
  "▀": [{ top: "0", right: "0", bottom: "50%", left: "0" }],
  "▁": [{ top: "87.5%", right: "0", bottom: "0", left: "0" }],
  "▂": [{ top: "75%", right: "0", bottom: "0", left: "0" }],
  "▃": [{ top: "62.5%", right: "0", bottom: "0", left: "0" }],
  "▄": [{ top: "50%", right: "0", bottom: "0", left: "0" }],
  "▅": [{ top: "37.5%", right: "0", bottom: "0", left: "0" }],
  "▆": [{ top: "25%", right: "0", bottom: "0", left: "0" }],
  "▇": [{ top: "12.5%", right: "0", bottom: "0", left: "0" }],
  "█": [{ top: "0", right: "0", bottom: "0", left: "0" }],
  "▉": [{ top: "0", right: "12.5%", bottom: "0", left: "0" }],
  "▊": [{ top: "0", right: "25%", bottom: "0", left: "0" }],
  "▋": [{ top: "0", right: "37.5%", bottom: "0", left: "0" }],
  "▌": [{ top: "0", right: "50%", bottom: "0", left: "0" }],
  "▍": [{ top: "0", right: "62.5%", bottom: "0", left: "0" }],
  "▎": [{ top: "0", right: "75%", bottom: "0", left: "0" }],
  "▏": [{ top: "0", right: "87.5%", bottom: "0", left: "0" }],
  "▐": [{ top: "0", right: "0", bottom: "0", left: "50%" }],
  "▔": [{ top: "0", right: "0", bottom: "87.5%", left: "0" }],
  "▕": [{ top: "0", right: "0", bottom: "0", left: "87.5%" }],
  "▖": [{ top: "50%", right: "50%", bottom: "0", left: "0" }],
  "▗": [{ top: "50%", right: "0", bottom: "0", left: "50%" }],
  "▘": [{ top: "0", right: "50%", bottom: "50%", left: "0" }],
  "▙": [
    { top: "0", right: "50%", bottom: "0", left: "0" },
    { top: "50%", right: "0", bottom: "0", left: "50%" },
  ],
  "▚": [
    { top: "0", right: "50%", bottom: "50%", left: "0" },
    { top: "50%", right: "0", bottom: "0", left: "50%" },
  ],
  "▛": [
    { top: "0", right: "0", bottom: "50%", left: "0" },
    { top: "50%", right: "50%", bottom: "0", left: "0" },
  ],
  "▜": [
    { top: "0", right: "0", bottom: "50%", left: "0" },
    { top: "50%", right: "0", bottom: "0", left: "50%" },
  ],
  "▝": [{ top: "0", right: "0", bottom: "50%", left: "50%" }],
  "▞": [
    { top: "0", right: "0", bottom: "50%", left: "50%" },
    { top: "50%", right: "50%", bottom: "0", left: "0" },
  ],
  "▟": [
    { top: "0", right: "0", bottom: "0", left: "50%" },
    { top: "50%", right: "50%", bottom: "0", left: "0" },
  ],
};

export function terminalBoxSegments(grapheme: string): TerminalBoxSegments | null {
  return TERMINAL_BOX_SEGMENTS[grapheme] ?? null;
}

export function terminalBlockRects(grapheme: string): readonly TerminalBlockRect[] | null {
  return TERMINAL_BLOCK_RECTS[grapheme] ?? null;
}
