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
  return (
    <div className="pull-dialog-backdrop" role="presentation">
      <section className="pull-dialog" role="dialog" aria-modal="true" aria-label="Pull branch">
        <div className="pull-dialog-title">Pull current branch</div>
        <div className="pull-dialog-copy">
          Choose how to integrate remote changes for {projectName}.
        </div>
        <div className="pull-dialog-actions">
          <button
            className="ghost-button pull-action"
            disabled={pending}
            onClick={() => onPull("merge")}
          >
            {pending ? <Loader2 className="spin" size={13} /> : null}
            Merge
          </button>
          <button
            className="ghost-button pull-action"
            disabled={pending}
            onClick={() => onPull("rebase")}
          >
            Rebase
          </button>
          <button className="ghost-button pull-action quiet" disabled={pending} onClick={onCancel}>
            Cancel
          </button>
        </div>
        {error ? (
          <div className="pull-dialog-error">
            Pull stopped. Refresh is complete, check Changes for conflicts.
            <span>{error}</span>
          </div>
        ) : null}
      </section>
    </div>
  );
}
