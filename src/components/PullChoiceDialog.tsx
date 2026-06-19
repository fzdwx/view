import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import type { PullMode } from "../lib/api";

export function PullChoiceDialog({
  error,
  pending,
  projectName,
  onCancel,
  onPull,
}: {
  error: string | null;
  pending: boolean;
  projectName: string;
  onCancel(): void;
  onPull(mode: PullMode): void;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) {
      return;
    }
    dialog.showModal();
    return () => {
      if (dialog.open) {
        dialog.close();
      }
    };
  }, []);

  return (
    // <dialog> is inherently interactive; react-doctor doesn't recognize native dialog interactivity.
    // oxlint-disable-next-line react-doctor/no-noninteractive-element-interactions
    <dialog
      ref={dialogRef}
      className="pull-dialog"
      aria-label="Pull branch"
      onCancel={onCancel}
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      <div className="pull-dialog-title">Pull current branch</div>
      <div className="pull-dialog-copy">
        Choose how to integrate remote changes for {projectName}.
      </div>
      <div className="pull-dialog-actions">
        <button
          className="ghost-button pull-action"
          type="button"
          disabled={pending}
          onClick={() => onPull("merge")}
        >
          {pending ? <Loader2 className="spin" size={13} /> : null}
          Merge
        </button>
        <button
          className="ghost-button pull-action"
          type="button"
          disabled={pending}
          onClick={() => onPull("rebase")}
        >
          Rebase
        </button>
        <button
          type="button"
          className="ghost-button pull-action quiet"
          disabled={pending}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
      {error ? (
        <div className="pull-dialog-error">
          Pull stopped. Refresh is complete, check Changes for conflicts.
          <span>{error}</span>
        </div>
      ) : null}
    </dialog>
  );
}
