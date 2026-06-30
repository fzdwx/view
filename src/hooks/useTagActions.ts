import { useCallback, useMemo, useState } from "react";
import {
  createTag,
  deleteTag,
  isTauriRuntime,
  pushTag,
  type RepositoryPayload,
  type TagInfo,
} from "../lib/api";
import {
  createTagTargetLabel,
  normalizeTagActionInput,
  normalizeTagName,
  tagActionDisabledReason,
  tagPushConfirmation,
} from "../lib/tagActions";
import { confirmNativeDialog, showNativeMessage } from "../lib/nativeDialogs";
import type { SavedProject } from "../lib/projects";
import {
  gitWriteOperationPendingTitle,
  type GitWriteGuard,
  type GitWriteOperation,
} from "./useGitWriteGuard";

export type TagActionKind = "create" | "delete" | "push";

export interface TagActionPending {
  readonly kind: TagActionKind;
  readonly name: string | null;
}

export interface TagActions {
  readonly error: string | null;
  readonly pending: TagActionPending | null;
  readonly pendingTitle: string | null;
  readonly create: (target: string | null) => Promise<void>;
  readonly delete: (tag: TagInfo) => Promise<void>;
  readonly push: (tag: TagInfo) => Promise<void>;
}

export interface UseTagActionsOptions {
  readonly activeProject: SavedProject | undefined;
  readonly gitWriteGuard: GitWriteGuard;
  readonly hasGitRepository: boolean;
  readonly repositoryPayload: RepositoryPayload | undefined;
  readonly refreshProjectFileState: (projectPath: string) => Promise<void>;
}

export function useTagActions({
  activeProject,
  gitWriteGuard,
  hasGitRepository,
  repositoryPayload,
  refreshProjectFileState,
}: UseTagActionsOptions): TagActions {
  const activeProjectPath = activeProject?.activePath ?? null;
  const [pending, setPending] = useState<TagActionPending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { beginGitWrite, endGitWrite, pendingOperation } = gitWriteGuard;
  const repositoryPendingReason = gitWriteOperationPendingTitle(pendingOperation);
  const defaultRemote = useMemo(
    () => firstRemoteName(repositoryPayload) ?? "origin",
    [repositoryPayload],
  );

  const runTagMutation = useCallback(
    async (
      kind: TagActionKind,
      name: string | null,
      operation: () => Promise<void>,
    ) => {
      if (!activeProjectPath || !isTauriRuntime()) {
        return;
      }

      const gitOperation = {
        kind: "tag",
        scope: "repository",
      } satisfies GitWriteOperation;
      if (!beginGitWrite(gitOperation)) {
        return;
      }

      setPending({ kind, name });
      setError(null);
      try {
        await operation();
        await refreshProjectFileState(activeProjectPath);
      } catch (caught) {
        const message = errorMessage(caught);
        setError(message);
        await showNativeMessage(message, { kind: "error" });
        await refreshProjectFileState(activeProjectPath);
      } finally {
        setPending(null);
        endGitWrite(gitOperation);
      }
    },
    [activeProjectPath, beginGitWrite, endGitWrite, refreshProjectFileState],
  );

  const create = useCallback(
    async (target: string | null) => {
      const targetLabel = createTagTargetLabel(target);
      const name = window.prompt(`New tag at ${targetLabel}`, "");
      if (name === null) {
        return;
      }
      const message = window.prompt("Annotated tag message", "") ?? "";
      const input = normalizeTagActionInput({ name, message });
      const disabledReason = tagActionDisabledReason({
        activeProjectPath,
        hasGitRepository,
        name: input.name,
        pendingReason: repositoryPendingReason,
      });
      if (disabledReason) {
        setError(disabledReason);
        await showNativeMessage(disabledReason, { kind: "warning" });
        return;
      }

      await runTagMutation("create", input.name, async () => {
        await createTag({
          path: requireActiveProjectPath(activeProjectPath),
          name: input.name,
          target: target?.trim() || "HEAD",
          message: input.message,
        });
      });
    },
    [
      activeProjectPath,
      hasGitRepository,
      repositoryPendingReason,
      runTagMutation,
    ],
  );

  const deleteLocalTag = useCallback(
    async (tag: TagInfo) => {
      const name = normalizeTagName(tag.refName || tag.name);
      const disabledReason = tagActionDisabledReason({
        activeProjectPath,
        hasGitRepository,
        name,
        pendingReason: repositoryPendingReason,
      });
      if (disabledReason) {
        setError(disabledReason);
        await showNativeMessage(disabledReason, { kind: "warning" });
        return;
      }
      if (
        !(await confirmNativeDialog(`Delete local tag ${name}?`, {
          cancelLabel: "Cancel",
          kind: "warning",
          okLabel: "Delete",
        }))
      ) {
        return;
      }

      await runTagMutation("delete", name, async () => {
        await deleteTag({
          path: requireActiveProjectPath(activeProjectPath),
          name,
        });
      });
    },
    [
      activeProjectPath,
      hasGitRepository,
      repositoryPendingReason,
      runTagMutation,
    ],
  );

  const push = useCallback(
    async (tag: TagInfo) => {
      const name = normalizeTagName(tag.refName || tag.name);
      const remote = window.prompt("Push tag to remote", defaultRemote);
      if (remote === null) {
        return;
      }
      const normalizedRemote = remote.trim();
      if (!normalizedRemote) {
        const message = "Enter a remote name.";
        setError(message);
        await showNativeMessage(message, { kind: "warning" });
        return;
      }
      const disabledReason = tagActionDisabledReason({
        activeProjectPath,
        hasGitRepository,
        name,
        pendingReason: repositoryPendingReason,
      });
      if (disabledReason) {
        setError(disabledReason);
        await showNativeMessage(disabledReason, { kind: "warning" });
        return;
      }
      if (
        !(await confirmNativeDialog(tagPushConfirmation(name, normalizedRemote), {
          cancelLabel: "Cancel",
          kind: "info",
          okLabel: "Push",
        }))
      ) {
        return;
      }

      await runTagMutation("push", name, async () => {
        await pushTag({
          path: requireActiveProjectPath(activeProjectPath),
          name,
          remote: normalizedRemote,
        });
      });
    },
    [
      activeProjectPath,
      defaultRemote,
      hasGitRepository,
      repositoryPendingReason,
      runTagMutation,
    ],
  );

  return {
    error,
    pending,
    pendingTitle: repositoryPendingReason,
    create,
    delete: deleteLocalTag,
    push,
  };
}

function firstRemoteName(payload: RepositoryPayload | undefined): string | null {
  for (const branch of payload?.summary.branches ?? []) {
    if (branch.branchType !== "remote") {
      continue;
    }
    const [remote] = branch.name.split("/");
    if (remote) {
      return remote;
    }
  }
  return null;
}

function requireActiveProjectPath(path: string | null): string {
  if (!path) {
    throw new Error("Open a repository before editing tags.");
  }
  return path;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
