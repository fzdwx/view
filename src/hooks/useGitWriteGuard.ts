import { useCallback, useRef, useState } from "react";

export type GitFileActionKind = "restore" | "stage" | "unstage";
export type GitRepositoryWriteKind =
  | "abort"
  | "amend"
  | "cherryPick"
  | "commit"
  | "continue"
  | "fixup"
  | "push"
  | "rebase"
  | "remote"
  | "reset"
  | "reword"
  | "revert"
  | "skip"
  | "squash"
  | "stash"
  | "tag";

export type GitWriteOperation =
  | {
      readonly scope: "file";
      readonly kind: GitFileActionKind;
      readonly path: string;
    }
  | {
      readonly scope: "repository";
      readonly kind: GitRepositoryWriteKind;
    };

export interface GitWriteGuard {
  readonly beginGitWrite: (operation: GitWriteOperation) => boolean;
  readonly endGitWrite: (operation: GitWriteOperation) => void;
  readonly pendingOperation: GitWriteOperation | null;
}

export function useGitWriteGuard(): GitWriteGuard {
  const pendingOperationRef = useRef<GitWriteOperation | null>(null);
  const [pendingOperation, setPendingOperation] =
    useState<GitWriteOperation | null>(null);

  const beginGitWrite = useCallback((operation: GitWriteOperation): boolean => {
    if (pendingOperationRef.current) {
      return false;
    }

    pendingOperationRef.current = operation;
    setPendingOperation(operation);
    return true;
  }, []);

  const endGitWrite = useCallback((operation: GitWriteOperation) => {
    if (pendingOperationRef.current !== operation) {
      return;
    }

    pendingOperationRef.current = null;
    setPendingOperation(null);
  }, []);

  return {
    beginGitWrite,
    endGitWrite,
    pendingOperation,
  };
}

export function gitWriteOperationPendingTitle(
  operation: GitWriteOperation | null,
): string | null {
  if (!operation) {
    return null;
  }

  switch (operation.scope) {
    case "file":
      return `A Git ${fileActionLabel(operation.kind)} action is already running for ${operation.path}.`;
    case "repository":
      return `A Git ${repositoryActionLabel(operation.kind)} is already running.`;
  }
}

function fileActionLabel(kind: GitFileActionKind): string {
  switch (kind) {
    case "restore":
      return "restore";
    case "stage":
      return "stage";
    case "unstage":
      return "unstage";
  }
}

function repositoryActionLabel(kind: GitRepositoryWriteKind): string {
  switch (kind) {
    case "abort":
      return "abort";
    case "amend":
      return "amend";
    case "cherryPick":
      return "cherry-pick";
    case "commit":
      return "commit";
    case "continue":
      return "continue";
    case "fixup":
      return "fixup";
    case "push":
      return "push";
    case "rebase":
      return "rebase";
    case "remote":
      return "remote";
    case "reset":
      return "reset";
    case "reword":
      return "reword";
    case "revert":
      return "revert";
    case "skip":
      return "skip";
    case "squash":
      return "squash";
    case "stash":
      return "stash";
    case "tag":
      return "tag";
  }
}
