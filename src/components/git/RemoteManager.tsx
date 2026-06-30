import { GitFork, Loader2, PenLine, Plus, Trash2 } from "lucide-react";
import type { RemoteActions } from "../../hooks/useRemoteActions";

export function RemoteManager({
  actions,
}: {
  readonly actions: RemoteActions;
}) {
  return (
    <section className="remote-manager" aria-label="Git remotes">
      <div className="remote-manager-header">
        <span>Remotes</span>
        <button
          type="button"
          className="branch-section-action"
          aria-label="Add remote"
          title="Add remote"
          disabled={Boolean(actions.pending)}
          onClick={() => void actions.add()}
        >
          <Plus size={13} />
        </button>
      </div>
      {actions.loading ? (
        <div className="remote-row muted">
          <Loader2 className="spin" size={13} />
          <span>Loading</span>
        </div>
      ) : actions.remotes.length === 0 ? (
        <div className="remote-row muted">
          <GitFork size={13} />
          <span>No remotes</span>
        </div>
      ) : (
        actions.remotes.map((remote) => (
          <div key={remote.name} className="remote-row">
            <GitFork size={13} />
            <span className="remote-name">{remote.name}</span>
            <span className="remote-url" title={remote.url}>{remote.url}</span>
            <button
              type="button"
              className="remote-row-button"
              aria-label={`Rename ${remote.name}`}
              title={`Rename ${remote.name}`}
              disabled={Boolean(actions.pending)}
              onClick={() => void actions.rename(remote)}
            >
              <PenLine size={12} />
            </button>
            <button
              type="button"
              className="remote-row-button danger"
              aria-label={`Remove ${remote.name}`}
              title={`Remove ${remote.name}`}
              disabled={Boolean(actions.pending)}
              onClick={() => void actions.remove(remote)}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))
      )}
      {actions.error ? (
        <div className="remote-manager-error" role="alert" title={actions.error}>
          {actions.error}
        </div>
      ) : null}
    </section>
  );
}
