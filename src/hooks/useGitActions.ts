import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  type BranchInfo,
  type PullMode,
  checkoutBranch,
  createBranch,
  deleteBranch,
  deleteRemoteBranch,
  isTauriRuntime,
  pullCurrentBranch,
  renameBranch,
  setBranchUpstream,
} from "../lib/api";
import {
  type BranchActionKind,
  defaultNewBranchName,
} from "../lib/branchModels";
import { confirmNativeDialog, showNativeMessage } from "../lib/nativeDialogs";
import type { SavedProject } from "../lib/projects";
import { normalizeRemoteBranchName } from "../lib/remoteActions";

type RefetchQuery = () => Promise<unknown>;

export interface UseGitActionsOptions {
  readonly activeBranchRef: string | null;
  readonly activeProject: SavedProject | undefined;
  readonly confirmDiscardProjectDrafts: (
    projectPath: string,
    action: string,
  ) => boolean;
  readonly discardDraftsForProject: (projectPath: string) => void;
  readonly hasGitRepository: boolean;
  readonly refetchCommits: RefetchQuery;
  readonly refetchFileWorktreeDiff: RefetchQuery;
  readonly refetchProjectFiles: RefetchQuery;
  readonly refetchReflog: RefetchQuery;
  readonly refetchRepository: RefetchQuery;
  readonly refreshProjectFileState: (projectPath: string) => Promise<void>;
  readonly setActiveBranchRef: Dispatch<SetStateAction<string | null>>;
  readonly setActiveCommit: Dispatch<SetStateAction<string | null>>;
  readonly setSelectedChangePath: Dispatch<SetStateAction<string | null>>;
  readonly showDiffSelection: () => void;
}

export interface GitActions {
  readonly openPullChoice: () => void;
  readonly performBranchAction: (
    action: BranchActionKind,
    branch: BranchInfo,
  ) => Promise<void>;
  readonly performPull: (mode: PullMode) => Promise<void>;
  readonly pullChoiceOpen: boolean;
  readonly pullError: string | null;
  readonly pullPending: boolean;
  readonly setPullChoiceOpen: Dispatch<SetStateAction<boolean>>;
}

export function useGitActions({
  activeBranchRef,
  activeProject,
  confirmDiscardProjectDrafts,
  discardDraftsForProject,
  hasGitRepository,
  refetchCommits,
  refetchFileWorktreeDiff,
  refetchProjectFiles,
  refetchReflog,
  refetchRepository,
  refreshProjectFileState,
  setActiveBranchRef,
  setActiveCommit,
  setSelectedChangePath,
  showDiffSelection,
}: UseGitActionsOptions): GitActions {
  const [pullChoiceOpen, setPullChoiceOpen] = useState(false);
  const [pullPending, setPullPending] = useState(false);
  const [pullError, setPullError] = useState<string | null>(null);
  const branchPullInFlightRef = useRef(false);

  const openPullChoice = useCallback(() => {
    if (!activeProject || !hasGitRepository || !isTauriRuntime()) {
      return;
    }
    setPullError(null);
    setPullChoiceOpen(true);
  }, [activeProject, hasGitRepository]);

  const performPull = useCallback(
    async (mode: PullMode) => {
      if (!activeProject || !hasGitRepository || branchPullInFlightRef.current) {
        return;
      }

      branchPullInFlightRef.current = true;
      setPullPending(true);
      setPullError(null);
      try {
        await pullCurrentBranch(activeProject.activePath, mode);
        setPullChoiceOpen(false);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setPullError(message);
        console.warn("Failed to pull current branch", error);
      } finally {
        await Promise.all([
          refetchRepository(),
          refetchCommits(),
          refetchProjectFiles(),
          refetchReflog(),
          refetchFileWorktreeDiff(),
        ]);
        branchPullInFlightRef.current = false;
        setPullPending(false);
      }
    },
    [
      activeProject,
      refetchCommits,
      refetchFileWorktreeDiff,
      hasGitRepository,
      refetchProjectFiles,
      refetchReflog,
      refetchRepository,
    ],
  );

  const resetDiffSelection = useCallback(() => {
    setActiveCommit(null);
    setSelectedChangePath(null);
    showDiffSelection();
  }, [setActiveCommit, setSelectedChangePath, showDiffSelection]);

  const performBranchAction = useCallback(
    async (action: BranchActionKind, branch: BranchInfo) => {
      if (!activeProject || !hasGitRepository || !isTauriRuntime()) {
        return;
      }

      const branchLabel = branch.name;
      try {
        switch (action) {
          case "checkout": {
            if (
              !confirmDiscardProjectDrafts(
                activeProject.activePath,
                `checkout ${branchLabel}`,
              )
            ) {
              return;
            }
            await checkoutBranch(activeProject.activePath, branch.refName);
            discardDraftsForProject(activeProject.activePath);
            setActiveBranchRef(null);
            resetDiffSelection();
            await refreshProjectFileState(activeProject.activePath);
            return;
          }
          case "create": {
            const name = window.prompt(
              `New branch from ${branchLabel}`,
              defaultNewBranchName(branch),
            );
            if (!name) {
              return;
            }
            if (
              !confirmDiscardProjectDrafts(
                activeProject.activePath,
                `create and checkout ${name}`,
              )
            ) {
              return;
            }
            await createBranch(activeProject.activePath, name, branch.refName);
            discardDraftsForProject(activeProject.activePath);
            setActiveBranchRef(null);
            resetDiffSelection();
            await refreshProjectFileState(activeProject.activePath);
            return;
          }
          case "rename": {
            if (branch.branchType !== "local") {
              await showNativeMessage("Only local branches can be renamed.", {
                kind: "warning",
              });
              return;
            }
            const nextName = window.prompt(`Rename ${branchLabel}`, branch.name);
            if (!nextName || nextName === branch.name) {
              return;
            }
            await renameBranch(activeProject.activePath, branch.refName, nextName);
            setActiveBranchRef(`refs/heads/${nextName}`);
            await refreshProjectFileState(activeProject.activePath);
            return;
          }
          case "delete": {
            if (branch.branchType !== "local") {
              await showNativeMessage("Only local branches can be deleted here.", {
                kind: "warning",
              });
              return;
            }
            if (
              !(await confirmNativeDialog(`Delete local branch ${branchLabel}?`, {
                cancelLabel: "Cancel",
                kind: "warning",
                okLabel: "Delete",
              }))
            ) {
              return;
            }
            try {
              await deleteBranch(activeProject.activePath, branch.refName, false);
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              if (
                !(await confirmNativeDialog(
                  `${message}\n\nForce delete ${branchLabel}?`,
                  {
                    cancelLabel: "Cancel",
                    kind: "warning",
                    okLabel: "Force Delete",
                  },
                ))
              ) {
                return;
              }
              await deleteBranch(activeProject.activePath, branch.refName, true);
            }
            if (activeBranchRef === branch.refName) {
              setActiveBranchRef(null);
            }
            await refreshProjectFileState(activeProject.activePath);
            return;
          }
          case "setUpstream": {
            if (branch.branchType !== "local") {
              await showNativeMessage("Only local branches can track upstreams.", {
                kind: "warning",
              });
              return;
            }
            const upstream = window.prompt(
              `Set upstream for ${branchLabel}`,
              branch.upstream?.replace(/^refs\/remotes\//, "") ?? `origin/${branch.name}`,
            );
            if (!upstream?.trim()) {
              return;
            }
            await setBranchUpstream({
              path: activeProject.activePath,
              branch: branch.name,
              upstream: upstream.trim(),
            });
            await refreshProjectFileState(activeProject.activePath);
            return;
          }
          case "deleteRemote": {
            if (branch.branchType !== "remote") {
              await showNativeMessage("Only remote branches can be deleted here.", {
                kind: "warning",
              });
              return;
            }
            const [remoteName] = branch.name.split("/");
            const remoteBranch = normalizeRemoteBranchName(branch.name);
            if (!remoteName || !remoteBranch) {
              await showNativeMessage("Remote branch name is invalid.", {
                kind: "warning",
              });
              return;
            }
            if (
              !(await confirmNativeDialog(`Delete remote branch ${branch.name}?`, {
                cancelLabel: "Cancel",
                kind: "warning",
                okLabel: "Delete",
              }))
            ) {
              return;
            }
            await deleteRemoteBranch({
              path: activeProject.activePath,
              remote: remoteName,
              branch: remoteBranch,
            });
            if (activeBranchRef === branch.refName) {
              setActiveBranchRef(null);
            }
            await refreshProjectFileState(activeProject.activePath);
            return;
          }
          default: {
            const exhaustiveAction: never = action;
            return exhaustiveAction;
          }
        }
      } catch (error) {
        await showNativeMessage(
          error instanceof Error ? error.message : String(error),
          { kind: "error" },
        );
        await refreshProjectFileState(activeProject.activePath);
      }
    },
    [
      activeBranchRef,
      activeProject,
      confirmDiscardProjectDrafts,
      discardDraftsForProject,
      hasGitRepository,
      refreshProjectFileState,
      resetDiffSelection,
      setActiveBranchRef,
    ],
  );

  return {
    openPullChoice,
    performBranchAction,
    performPull,
    pullChoiceOpen,
    pullError,
    pullPending,
    setPullChoiceOpen,
  };
}
