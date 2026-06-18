import type { SaveConflict } from "./api";

export type FileViewMode = "preview" | "source";

export interface EditorDraft {
  readonly baseContent: string;
  readonly content: string;
  readonly conflict: SaveConflict | null;
}

export interface EditorGitMarker {
  readonly id: string;
  readonly line: number;
  readonly lineCount: number;
  readonly oldStart: number;
  readonly oldLineCount: number;
  readonly newStart: number;
  readonly newLineCount: number;
  readonly additions: number;
  readonly deletions: number;
  readonly kind: "added" | "modified" | "deleted";
  readonly oldLines: readonly string[];
  readonly newLines: readonly string[];
  readonly diffLines: readonly string[];
}

export interface EditorFindState {
  readonly open: boolean;
  readonly replaceOpen: boolean;
  readonly query: string;
  readonly replaceText: string;
  readonly activeIndex: number;
}

export interface EditorScrollMetrics {
  readonly top: number;
  readonly left: number;
  readonly height: number;
  readonly width: number;
}

export type EditorSearchHighlightSegment =
  | {
      readonly kind: "plain";
      readonly text: string;
    }
  | {
      readonly kind: "match";
      readonly text: string;
    };
