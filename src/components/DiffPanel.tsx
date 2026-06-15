import type { FileDiffMetadata } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";

interface DiffPanelProps {
  error: string | null;
  files: FileDiffMetadata[];
  title: string;
}

export function DiffPanel({ error, files, title }: DiffPanelProps) {
  if (error) {
    return (
      <div className="empty-state">
        <div className="empty-title">Diff could not be parsed</div>
        <div className="empty-copy">{error}</div>
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-title">No diff to render</div>
        <div className="empty-copy">
          Select a commit with file changes, or open a worktree with staged or
          unstaged changes.
        </div>
      </div>
    );
  }

  return (
    <section className="diff-shell" aria-label={title}>
      {files.map((fileDiff, index) => (
        <FileDiff
          key={`${fileDiff.name}-${fileDiff.prevName ?? ""}-${index}`}
          fileDiff={fileDiff}
          className="diff-view"
          options={{
            diffStyle: "split",
            overflow: "scroll",
            hunkSeparators: "line-info",
            lineDiffType: "none",
            tokenizeMaxLineLength: 400,
            collapsedContextThreshold: 4,
            theme: {
              light: "github-light",
              dark: "github-dark",
            },
            themeType: "light",
          }}
        />
      ))}
    </section>
  );
}
