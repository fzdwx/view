import { Code2, Image as ImageIcon } from "lucide-react";
import type { FileViewMode } from "../../lib/editorTypes";
import { fileNameFromPath } from "../../lib/pathLabels";

export function MediaViewToolbar({
  canShowSource,
  mediaType,
  mode,
  path,
  onChangeMode,
}: {
  canShowSource: boolean;
  mediaType: string | null;
  mode: FileViewMode;
  path: string;
  onChangeMode(mode: FileViewMode): void;
}) {
  return (
    <div className="media-view-toolbar">
      <div className="media-view-title" title={path}>
        <ImageIcon size={14} />
        <span>{fileNameFromPath(path)}</span>
        {mediaType ? <small>{mediaType}</small> : null}
      </div>
      <div className="media-view-switch" role="tablist" aria-label="File view mode">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "preview"}
          className={mode === "preview" ? "active" : ""}
          onClick={() => onChangeMode("preview")}
        >
          <ImageIcon size={13} />
          Preview
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "source"}
          className={mode === "source" ? "active" : ""}
          disabled={!canShowSource}
          onClick={() => onChangeMode("source")}
        >
          <Code2 size={13} />
          Source
        </button>
      </div>
    </div>
  );
}
