export const terminalInternalLinkEvent = "view:terminal-internal-link";

export interface TerminalNavigationContext {
  readonly cwd: string | null;
  readonly projectPath: string;
}

export type TerminalInternalLink =
  | {
      readonly kind: "commit";
      readonly hash: string;
      readonly projectPath: string;
    }
  | {
      readonly kind: "file";
      readonly columnNumber: number | null;
      readonly lineNumber: number;
      readonly path: string;
      readonly projectPath: string;
    };

export interface TerminalLinkSegment {
  readonly text: string;
  readonly link?: TerminalInternalLink;
}

export interface TerminalInternalLinkEventDetail {
  readonly link: TerminalInternalLink;
}

interface TerminalLinkMatch {
  readonly end: number;
  readonly link: TerminalInternalLink;
  readonly start: number;
}

const FILE_LOCATION_PATTERN =
  /(?:\/|\.{1,2}\/|[A-Za-z0-9_.-]+\/|[A-Za-z0-9_.-]+\.[A-Za-z0-9]{1,12})(?:[^\s"'<>:]*)?:(\d{1,7})(?::(\d{1,7}))?/g;
const COMMIT_HASH_PATTERN = /\b[0-9a-fA-F]{7,40}\b/g;

export function terminalLinkSegments(
  text: string,
  context: TerminalNavigationContext,
): readonly TerminalLinkSegment[] {
  if (!text || !context.projectPath) {
    return [{ text }];
  }

  const matches = collectTerminalLinkMatches(text, context);
  if (matches.length === 0) {
    return [{ text }];
  }

  const segments: TerminalLinkSegment[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start > cursor) {
      segments.push({ text: text.slice(cursor, match.start) });
    }
    segments.push({
      text: text.slice(match.start, match.end),
      link: match.link,
    });
    cursor = match.end;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor) });
  }

  return segments;
}

export function dispatchTerminalInternalLink(link: TerminalInternalLink): void {
  window.dispatchEvent(
    new CustomEvent<TerminalInternalLinkEventDetail>(
      terminalInternalLinkEvent,
      { detail: { link } },
    ),
  );
}

function collectTerminalLinkMatches(
  text: string,
  context: TerminalNavigationContext,
): readonly TerminalLinkMatch[] {
  const matches: TerminalLinkMatch[] = [];

  FILE_LOCATION_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(FILE_LOCATION_PATTERN)) {
    const raw = match[0];
    const lineNumber = toPositiveInt(match[1]);
    if (!raw || lineNumber == null || match.index == null) {
      continue;
    }
    const columnNumber = toPositiveInt(match[2]);
    const filePath = raw.slice(
      0,
      raw.length -
        match[1].length -
        1 -
        (match[2] ? match[2].length + 1 : 0),
    );
    const path = terminalFilePathToProjectPath(filePath, context);
    if (!path) {
      continue;
    }
    matches.push({
      start: match.index,
      end: match.index + raw.length,
      link: {
        kind: "file",
        columnNumber,
        lineNumber,
        path,
        projectPath: context.projectPath,
      },
    });
  }

  COMMIT_HASH_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(COMMIT_HASH_PATTERN)) {
    const hash = match[0];
    if (!hash || match.index == null) {
      continue;
    }
    const start = match.index;
    const end = start + hash.length;
    if (matches.some((fileMatch) => overlaps(start, end, fileMatch))) {
      continue;
    }
    matches.push({
      start,
      end,
      link: {
        kind: "commit",
        hash,
        projectPath: context.projectPath,
      },
    });
  }

  return matches.sort((left, right) => left.start - right.start);
}

function terminalFilePathToProjectPath(
  filePath: string,
  context: TerminalNavigationContext,
): string | null {
  const projectPath = normalizeTerminalPath(context.projectPath);
  const cwd = context.cwd ? normalizeTerminalPath(context.cwd) : projectPath;
  const path = normalizeTerminalPath(filePath);
  const absolutePath = path.startsWith("/")
    ? path
    : normalizeTerminalPath(`${cwd}/${path}`);
  const relativePath = relativeProjectPath(projectPath, absolutePath);

  if (!relativePath || relativePath.startsWith("../")) {
    return null;
  }

  return relativePath;
}

function relativeProjectPath(projectPath: string, absolutePath: string): string | null {
  if (absolutePath === projectPath) {
    return null;
  }
  const prefix = `${projectPath}/`;
  if (!absolutePath.startsWith(prefix)) {
    return null;
  }

  return absolutePath.slice(prefix.length);
}

function normalizeTerminalPath(path: string): string {
  const replaced = path.trim().replace(/\\/g, "/");
  const absolute = replaced.startsWith("/");
  const parts: string[] = [];
  for (const part of replaced.split("/")) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      if (parts.length === 0) {
        parts.push("..");
      } else if (parts.at(-1) === "..") {
        parts.push("..");
      } else {
        parts.pop();
      }
      continue;
    }
    parts.push(part);
  }

  return `${absolute ? "/" : ""}${parts.join("/")}`;
}

function toPositiveInt(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function overlaps(start: number, end: number, match: TerminalLinkMatch): boolean {
  return start < match.end && end > match.start;
}
