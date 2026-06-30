import { memo, useId, useState } from "react";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Eye,
  Layers,
  Play,
  Trash2,
  Undo2,
} from "lucide-react";
import type { StashEntry } from "../../lib/api";
import type { StashActions } from "../../hooks/useStashActions";
import { shortStashHash } from "../../lib/stashActions";

export const StashList = memo(function StashList({
  actions,
}: {
  readonly actions: StashActions;
}) {
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();
  const busy = actions.pending !== null || actions.pendingTitle !== null;

  return (
    <section className="stash-list" aria-label="Stashes">
      <div className="stash-list-header">
        <button
          type="button"
          className="stash-list-toggle"
          aria-controls={bodyId}
          aria-expanded={expanded}
          title={expanded ? "Collapse stashes" : "Expand stashes"}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <span className="stash-list-title">Stashes</span>
        </button>
        <span className="stash-list-count">{actions.entries.length}</span>
        <button
          type="button"
          className="stash-primary-button"
          title={actions.pendingTitle ?? "Stash tracked and untracked changes"}
          disabled={busy}
          onClick={() => {
            void actions.create();
          }}
        >
          <Archive size={13} />
          <span>Stash</span>
        </button>
      </div>

      {expanded ? (
        <>
          <div id={bodyId} className="stash-list-body">
            {actions.loading ? (
              <div className="stash-empty">Loading stashes</div>
            ) : actions.entries.length === 0 ? (
              <div className="stash-empty">No stashes</div>
            ) : (
              actions.entries.map((entry) => (
                <StashRow
                  key={entry.selector}
                  actions={actions}
                  busy={busy}
                  entry={entry}
                />
              ))
            )}
          </div>

          {actions.selectedSelector ? (
            <div className="stash-diff-box">
              <div className="stash-diff-header">
                <Eye size={12} />
                <span>{actions.selectedSelector}</span>
              </div>
              {actions.selectedDiffLoading ? (
                <div className="stash-diff-empty">Loading diff</div>
              ) : actions.selectedDiff ? (
                <pre className="stash-diff-preview">{actions.selectedDiff}</pre>
              ) : (
                <div className="stash-diff-empty">No diff</div>
              )}
            </div>
          ) : null}

          {actions.error ? (
            <div className="stash-error" role="alert">
              {actions.error}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
});

StashList.displayName = "StashList";

function StashRow({
  actions,
  busy,
  entry,
}: {
  readonly actions: StashActions;
  readonly busy: boolean;
  readonly entry: StashEntry;
}) {
  const selected = actions.selectedSelector === entry.selector;
  const pending = actions.pending?.selector === entry.selector;
  const disabled = busy && !pending;

  return (
    <div className={selected ? "stash-row active" : "stash-row"}>
      <button
        type="button"
        className="stash-select-button"
        title={`${entry.selector} ${entry.hash}`}
        onClick={() => actions.select(entry)}
      >
        <Layers size={13} />
        <span className="stash-message">{entry.message}</span>
        <small className="stash-meta">
          {entry.selector} · {entry.branch} · {shortStashHash(entry.hash)}
        </small>
      </button>
      <button
        type="button"
        className="stash-icon-button"
        title="Apply stash"
        disabled={disabled}
        onClick={() => {
          void actions.apply(entry);
        }}
      >
        <Play size={12} />
      </button>
      <button
        type="button"
        className="stash-icon-button"
        title="Pop stash"
        disabled={disabled}
        onClick={() => {
          void actions.pop(entry);
        }}
      >
        <Undo2 size={12} />
      </button>
      <button
        type="button"
        className="stash-icon-button danger"
        title="Drop stash"
        disabled={disabled}
        onClick={() => {
          void actions.drop(entry);
        }}
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}
