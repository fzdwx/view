import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import type { FileDiffMetadata } from "@pierre/diffs";
import { FileDiff, Virtualizer } from "@pierre/diffs/react";
import { type FileContent, getFileBlob } from "../lib/api";

interface DiffPanelProps {
  error: string | null;
  files: FileDiffMetadata[];
  title: string;
  projectPath: string | null;
  commit: string | null;
}

const IMAGE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "ico",
  "jpg",
  "jpeg",
  "png",
  "svg",
  "webp",
]);

function getFileExtension(name: string): string {
  const parts = name.split(".");
  return parts.length > 1 ? (parts.pop() ?? "").toLowerCase() : "";
}

function isImageFile(file: FileDiffMetadata): boolean {
  return IMAGE_EXTENSIONS.has(getFileExtension(file.name));
}

function isBinaryFile(file: FileDiffMetadata): boolean {
  return file.hunks.length === 0 && file.splitLineCount === 0;
}

export function DiffPanel({
  error,
  files,
  title,
  projectPath,
  commit,
}: DiffPanelProps) {
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

  const imageFiles = files.filter(isImageFile);
  const binaryFiles = files.filter(
    (file) => !isImageFile(file) && isBinaryFile(file),
  );
  const textFiles = files.filter(
    (file) => !isImageFile(file) && !isBinaryFile(file),
  );

  return (
    <section className="diff-shell-frame" aria-label={title}>
      <Virtualizer
        className="diff-shell"
        contentClassName="diff-shell-content"
        config={{
          overscrollSize: 900,
          intersectionObserverMargin: 1200,
        }}
      >
        {textFiles.map((fileDiff, index) => (
          <FileDiff
            key={`${fileDiff.name}-${fileDiff.prevName ?? ""}-${index}`}
            fileDiff={fileDiff}
            className="diff-view"
            options={{
              diffStyle: "split",
              overflow: "scroll",
              hunkSeparators: "line-info",
              lineDiffType: "none",
              disableFileHeader: true,
              tokenizeMaxLineLength: 400,
              collapsedContextThreshold: 4,
              theme: {
                light: "pierre-light",
                dark: "pierre-dark",
              },
              themeType: "dark",
            }}
          />
        ))}
        {imageFiles.map((file, index) =>
          projectPath ? (
            <ImageDiffRow
              key={`img-${file.name}-${file.prevName ?? ""}-${index}`}
              file={file}
              projectPath={projectPath}
              commit={commit}
            />
          ) : null,
        )}
        {binaryFiles.map((file, index) => (
          <div
            key={`bin-${file.name}-${file.prevName ?? ""}-${index}`}
            className="binary-diff-placeholder"
          >
            <span className="binary-diff-icon">B</span>
            <span className="binary-diff-name">{file.name}</span>
            <span className="binary-diff-label">Binary file</span>
          </div>
        ))}
      </Virtualizer>
    </section>
  );
}

function ImageDiffRow({
  file,
  projectPath,
  commit,
}: {
  file: FileDiffMetadata;
  projectPath: string;
  commit: string | null;
}) {
  const isNew = file.type === "new";
  const isDeleted = file.type === "deleted";
  const oldRef = commit ? `${commit}^` : "HEAD";

  const { isLoading: newBlobLoading, isError: newBlobError, data: newBlob } = useQuery({
    queryKey: ["file-blob", projectPath, file.name, commit],
    queryFn: () => getFileBlob(projectPath, file.name, commit),
    enabled: !isDeleted,
    retry: false,
  });
  const { isLoading: oldBlobLoading, isError: oldBlobError, data: oldBlob } = useQuery({
    queryKey: ["file-blob", projectPath, file.prevName ?? file.name, oldRef],
    queryFn: () =>
      getFileBlob(projectPath, file.prevName ?? file.name, oldRef),
    enabled: !isNew,
    retry: false,
  });

  return (
    <div className="image-diff-row">
      <div className="image-diff-header">
        <span className="image-diff-filename">{file.name}</span>
        <span className={`image-diff-type ${file.type}`}>{file.type}</span>
      </div>
      <div
        className={
          isNew || isDeleted
            ? "image-diff-sides single"
            : "image-diff-sides"
        }
      >
        {!isNew ? (
         <ImageDiffSide
           label="Before"
            isLoading={oldBlobLoading}
            isError={oldBlobError}
            data={oldBlob}
            skipped={isNew}
            skippedLabel="Added"
         />
       ) : null}
       {!isNew && !isDeleted ? (
         <div className="image-diff-divider" />
       ) : null}
       {!isDeleted ? (
         <ImageDiffSide
           label="After"
            isLoading={newBlobLoading}
            isError={newBlobError}
            data={newBlob}
            skipped={isDeleted}
            skippedLabel="Deleted"
         />
       ) : null}
      </div>
    </div>
  );
}

function ImageDiffSide({
  label,
  isLoading,
  isError,
  data,
  skipped,
  skippedLabel,
}: {
  label: string;
  isLoading: boolean;
  isError: boolean;
  data: FileContent | undefined;
  skipped: boolean;
  skippedLabel: string;
}) {
  return (
    <div className="image-diff-side">
      <div className="image-diff-side-label">{label}</div>
      <div className="image-diff-side-body">
        {skipped ? (
          <div className="image-diff-placeholder">{skippedLabel}</div>
        ) : isLoading ? (
          <Loader2 className="spin" size={20} />
        ) : isError ? (
          <div className="image-diff-placeholder">Failed to load</div>
        ) : data?.tooLarge ? (
          <div className="image-diff-placeholder">Image too large</div>
        ) : data?.mediaDataUrl ? (
          <img
            className="image-diff-image"
            src={data.mediaDataUrl}
            alt={label}
          />
        ) : (
          <div className="image-diff-placeholder">No preview</div>
        )}
      </div>
    </div>
  );
}
