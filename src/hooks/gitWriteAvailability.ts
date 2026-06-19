import type { BranchInfo, TreeFile } from "../lib/api";
import {
  gitWriteOperationPendingTitle,
  type GitWriteOperation,
} from "./useGitWriteGuard";

export type { GitRepositoryWriteKind } from "./useGitWriteGuard";

export interface CommitReasonInput {
  readonly activeProjectPath: string | null;
  readonly conflictCount: number;
  readonly hasGitRepository: boolean;
  readonly hasNulByte: boolean;
  readonly pendingOperation: GitWriteOperation | null;
  readonly stagedCount: number;
  readonly trimmedMessage: string;
}

export interface PushReasonInput {
  readonly activeProjectPath: string | null;
  readonly branch: BranchInfo | null;
  readonly hasGitRepository: boolean;
  readonly pendingOperation: GitWriteOperation | null;
}

export function countStagedFiles(files: readonly TreeFile[]): number {
  return files.filter(isStagedFile).length;
}

export function countConflictFiles(files: readonly TreeFile[]): number {
  return files.filter(isConflictFile).length;
}

export function currentRepositoryBranch(
  branches: readonly BranchInfo[] | undefined,
): BranchInfo | null {
  return branches?.find((branch) => branch.current) ?? null;
}

export function commitDirtyDraftWarning(dirtyDraftCount: number): string | null {
  if (dirtyDraftCount === 0) {
    return null;
  }

  return `${dirtyDraftCount} unsaved editor draft${dirtyDraftCount > 1 ? "s" : ""} will not be included until saved and staged.`;
}

export function commitDisabledReason({
  activeProjectPath,
  conflictCount,
  hasGitRepository,
  hasNulByte,
  pendingOperation,
  stagedCount,
  trimmedMessage,
}: CommitReasonInput): string | null {
  if (!activeProjectPath) {
    return "Open a folder before committing.";
  }
  if (!hasGitRepository) {
    return "Open a Git repository before committing.";
  }
  const pendingReason = gitWriteOperationPendingTitle(pendingOperation);
  if (pendingReason) {
    return pendingReason;
  }
  if (hasNulByte) {
    return "Commit message cannot contain NUL bytes.";
  }
  if (trimmedMessage.length === 0) {
    return "Enter a commit message before committing.";
  }
  if (stagedCount === 0) {
    return "Stage at least one file before committing.";
  }
  if (conflictCount > 0) {
    return "Resolve conflicted files before committing.";
  }

  return null;
}

export function commitMessageLint(message: string): string | null {
  const normalized = message.replace(/\r\n/g, "\n");
  if (!normalized.trim()) {
    return null;
  }

  const [subject = "", ...bodyLines] = normalized.split("\n");
  if (subject.trim().length > 72) {
    return `Subject line is ${subject.trim().length} characters; aim for 72 or fewer.`;
  }

  if (bodyLines.some((line) => line.trim().length > 0) && bodyLines[0]?.trim()) {
    return "Add a blank line between the subject and body for readability.";
  }

  return null;
}

export function pushDisabledReason({
  activeProjectPath,
  branch,
  hasGitRepository,
  pendingOperation,
}: PushReasonInput): string | null {
  if (!activeProjectPath) {
    return "Open a folder before pushing.";
  }
  if (!hasGitRepository) {
    return "Open a Git repository before pushing.";
  }
  const pendingReason = gitWriteOperationPendingTitle(pendingOperation);
  if (pendingReason) {
    return pendingReason;
  }
  if (!branch?.current || branch.branchType !== "local") {
    return "Checkout a local branch before pushing.";
  }
  if (!branch.upstream) {
    return "Configure an upstream before pushing this branch.";
  }
  if (branch.ahead === null || branch.behind === null) {
    return "Fetch branch status before pushing.";
  }
  if (branch.ahead <= 0) {
    return "Current branch has no commits to push.";
  }
  if (branch.behind > 0) {
    return "Pull or rebase before pushing this branch.";
  }

  return null;
}

function isStagedFile(file: TreeFile): boolean {
  return file.staged === true;
}

function isConflictFile(file: TreeFile): boolean {
  return file.conflict === true;
}
