# Terminal And Git Workflow Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement and verify terminal search/history/read-only/progress support, full tag workflows, branch publish/upstream/remote management, commit editing, richer commit details, and file-tree directory operations.

**Architecture:** Keep Tauri command wrappers in `src/lib/api.ts`, Rust Git/file operations in `src-tauri/src/`, and UI logic in feature-specific components/hooks. Preserve `src/App.tsx` as orchestration only, using existing hook/component seams instead of adding heavy behavior there.

**Tech Stack:** React 19, Vite, TanStack Query/Virtual, Tauri 2 Rust commands, `@pierre/diffs`, `@pierre/trees`, Bun tests, Rust unit tests.

## Global Constraints

- Preserve existing user changes in `/home/like/projects/view`; this plan runs in `/home/like/projects/view-feature-batch` on `feature/terminal-git-workflows`.
- Use TDD for behavior changes: write the failing test, run it to confirm failure, implement the minimal code, then re-run.
- Do not call Tauri `invoke` directly from React components; wrappers belong in `src/lib/api.ts`.
- Do not expand `src/App.tsx` with substantial new feature logic.
- Keep Git command execution centralized in Rust helpers and normalize repository-relative paths.
- Keep UI dense and native-feeling; reuse current dark theme tokens and existing panels.
- Before handoff run: `bun test`, `bunx tsc --noEmit`, `bun run build`, `cd src-tauri && cargo test`, `git diff --check`.
- For visible UI behavior, record manual verification notes for the changed surfaces.

---

### Task 1: Terminal Search, Command Outline, Read-Only Mode, Refresh Throttle, And Progress

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/terminalTypes.ts`
- Modify: `src/lib/terminalSocketMessage.ts`
- Create: `src/lib/terminalCommandHistory.ts`
- Create: `src/lib/terminalCommandHistory.test.js`
- Modify: `src/lib/terminalSocketMessage.test.js`
- Modify: `src/components/TerminalPanel.tsx`
- Modify: `src/hooks/useTerminalVisualState.ts`
- Modify: `src/lib/terminalScreenHandlers.ts`
- Modify: `src/styles.css`

**Interfaces:**
- Produce `TerminalCommandEvent` records with `{ id, phase, exitCode, cwd, lineOffset, text }`.
- Produce `terminalCommandHistoryReducer(state, frame)` that updates command outline state from terminal frames.
- Extend `TerminalCommandStatus` to include optional progress fields `{ progressKind, percent }`.
- Add UI props/state for read-only mode and scrollback search without changing terminal spawn APIs.

- [ ] **Step 1: Write failing terminal protocol tests**

Add tests to `src/lib/terminalSocketMessage.test.js` and `src/lib/terminalCommandHistory.test.js` asserting:
- OSC `9;4;1;42` parses to `commandStatus.progressKind === "running"` and `percent === 42`.
- OSC `9;4;0` clears progress.
- Command history records a command boundary when a frame transitions through OSC 133 `running` to `finished`.
- Search helper finds matches in serialized terminal frame text and returns row/column positions.

Run:

```bash
bun test src/lib/terminalSocketMessage.test.js src/lib/terminalCommandHistory.test.js
```

Expected before implementation: FAIL because progress fields and history helpers do not exist.

- [ ] **Step 2: Implement Rust frame progress metadata**

Extend terminal OSC parsing in `src-tauri/src/lib.rs`:
- Parse `OSC 9;4;<state>[;<percent>]`.
- Map state `0` to cleared progress, `1` to running with percent, `2` to error, `3` to indeterminate, `5` to finished.
- Serialize progress into existing `TerminalCommandStatus`.
- Add Rust tests next to existing terminal OSC tests for parse and frame serialization.

Run:

```bash
cd src-tauri && cargo test terminal_osc
```

Expected after implementation: PASS.

- [ ] **Step 3: Implement frontend parsing and command history helpers**

Update `src/lib/terminalTypes.ts`, `src/lib/terminalSocketMessage.ts`, and `src/lib/terminalCommandHistory.ts`.

Run:

```bash
bun test src/lib/terminalSocketMessage.test.js src/lib/terminalCommandHistory.test.js
```

Expected after implementation: PASS.

- [ ] **Step 4: Add terminal UI controls**

In `src/components/TerminalPanel.tsx`:
- Add compact search field toggled from terminal toolbar.
- Add command outline/history popover driven by `terminalCommandHistoryReducer`.
- Add read-only toggle that blocks key, paste, mouse input forwarding while keeping scroll/copy/search active.
- Show progress text/badge in existing `TerminalCommandStatusBadge`.
- Throttle non-active terminal tab frame application so invisible tabs store latest frame but do not force high-frequency render.

Run:

```bash
bun test src/lib/terminalNavigation.test.js src/lib/terminalPasteProtection.test.js src/lib/terminalCommandHistory.test.js
bunx tsc --noEmit
```

Expected after implementation: PASS.

- [ ] **Step 5: Manual terminal acceptance**

Run the app and verify:
- Terminal search highlights and navigates results in scrollback.
- Command outline shows completed and failed commands after a shell with OSC 133 support emits markers.
- Read-only blocks typing and paste but allows scroll/copy/search.
- Background terminal tabs do not visibly update until selected.
- OSC 9;4 progress updates the terminal badge.

Record notes in the final handoff.

---

### Task 2: Full Tag Workflow

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/git_tag.rs`
- Create: `src-tauri/src/git_tag_tests.rs`
- Modify: `src/lib/api.ts`
- Modify: `src/components/git/TagGroup.tsx`
- Modify: `src/components/git/BranchTree.tsx`
- Create: `src/hooks/useTagActions.ts`
- Create: `src/lib/tagActions.ts`
- Create: `src/lib/tagActions.test.js`

**Interfaces:**
- Produce API wrappers: `createTag`, `deleteTag`, `pushTag`.
- Produce hook `useTagActions({ activeProject, refreshProjectFileState })`.
- Tag UI supports create from selected commit/current HEAD, delete local tag, push tag to selected remote.

- [ ] **Step 1: Write failing Rust tag tests**

Add tests covering:
- create lightweight tag at `HEAD`;
- create annotated tag with message;
- reject invalid tag names and NUL bytes;
- delete local tag;
- push a tag to configured remote.

Run:

```bash
cd src-tauri && cargo test git_tag
```

Expected before implementation: FAIL because module/commands do not exist.

- [ ] **Step 2: Implement Rust tag commands**

Implement `create_tag`, `delete_tag`, `push_tag` in `src-tauri/src/git_tag.rs`, register them in `src-tauri/src/lib.rs`, and return `GitWriteResponse`.

Run:

```bash
cd src-tauri && cargo test git_tag
```

Expected after implementation: PASS.

- [ ] **Step 3: Write failing frontend tag action tests**

Add `src/lib/tagActions.test.js` for tag name/message normalization and default tag target labels.

Run:

```bash
bun test src/lib/tagActions.test.js
```

Expected before implementation: FAIL because helpers do not exist.

- [ ] **Step 4: Implement API, hook, and UI**

Update `src/lib/api.ts`, add `useTagActions`, and extend `TagGroup` with a context menu:
- Create tag from selected commit or current branch head.
- Delete tag with confirmation.
- Push tag with confirmation.

Run:

```bash
bun test src/lib/tagActions.test.js
bunx tsc --noEmit
```

Expected after implementation: PASS.

---

### Task 3: Publish Branch, Upstream, And Remote Management

**Files:**
- Modify: `src-tauri/src/git_commit_push.rs`
- Create: `src-tauri/src/git_remote.rs`
- Create: `src-tauri/src/git_remote_tests.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/api.ts`
- Modify: `src/hooks/gitWriteAvailability.ts`
- Modify: `src/hooks/useGitWriteActions.ts`
- Modify: `src/hooks/useGitActions.ts`
- Modify: `src/components/git/PushAffordance.tsx`
- Modify: `src/components/git/BranchContextMenu.tsx`
- Create: `src/components/git/RemoteManager.tsx`
- Create: `src/lib/remoteActions.ts`
- Create: `src/lib/remoteActions.test.js`

**Interfaces:**
- Produce API wrappers: `listRemotes`, `addRemote`, `renameRemote`, `removeRemote`, `setBranchUpstream`, `pushCurrentBranch` with options, `deleteRemoteBranch`.
- Push UI supports publish branch when upstream is missing.
- Remote manager is a compact panel inside Git refs area, not a separate app shell.

- [ ] **Step 1: Write failing Rust remote tests**

Tests cover remote list/add/rename/remove, set upstream, publish branch with `--set-upstream`, delete remote branch, and force-with-lease requiring an explicit boolean.

Run:

```bash
cd src-tauri && cargo test git_remote git_commit_push
```

Expected before implementation: FAIL for missing remote commands/options.

- [ ] **Step 2: Implement Rust remote and publish commands**

Add typed request structs and command registration. Keep non-interactive Git env from current push flow.

Run:

```bash
cd src-tauri && cargo test git_remote git_commit_push
```

Expected after implementation: PASS.

- [ ] **Step 3: Write failing frontend remote tests**

Add `src/lib/remoteActions.test.js` for URL/name validation, publish labels, and force-with-lease confirmation copy.

Run:

```bash
bun test src/lib/remoteActions.test.js
```

Expected before implementation: FAIL.

- [ ] **Step 4: Implement API and UI**

Add wrappers, hook logic, PushAffordance publish branch flow, BranchContextMenu upstream actions, and RemoteManager.

Run:

```bash
bun test src/lib/remoteActions.test.js
bunx tsc --noEmit
```

Expected after implementation: PASS.

---

### Task 4: Commit Editing

**Files:**
- Modify: `src-tauri/src/git_history_ops.rs`
- Modify: `src-tauri/src/git_history_ops_tests.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/api.ts`
- Modify: `src/hooks/useGitWriteActions.ts`
- Modify: `src/components/git/CommitListView.tsx`
- Modify: `src/components/git/CommitForm.tsx`
- Create: `src/lib/commitEditActions.ts`
- Create: `src/lib/commitEditActions.test.js`

**Interfaces:**
- Produce API wrappers: `amendCommit`, `fixupCommit`, `rewordCommit`, `squashCommit`, `startInteractiveRebase`.
- Commit context menu adds Amend from staged, Fixup into selected, Reword selected, Squash selected into parent.
- Interactive rebase flow starts with a lightweight todo preview and uses existing operation continuation banner.

- [ ] **Step 1: Write failing Rust commit-edit tests**

Tests cover amend preserving staged-only behavior, fixup commit creation, reword selected commit via non-interactive rebase, squash selected commit into parent, and conflict/error mapping.

Run:

```bash
cd src-tauri && cargo test git_history_ops
```

Expected before implementation: FAIL for missing commands.

- [ ] **Step 2: Implement Rust commit edit commands**

Use safe revision validation from existing history ops. Require clean worktree where Git requires it. Use non-interactive editor env.

Run:

```bash
cd src-tauri && cargo test git_history_ops
```

Expected after implementation: PASS.

- [ ] **Step 3: Write failing frontend commit edit tests**

Add `src/lib/commitEditActions.test.js` for disabled states and confirmation copy.

Run:

```bash
bun test src/lib/commitEditActions.test.js
```

Expected before implementation: FAIL.

- [ ] **Step 4: Implement hook and menu UI**

Extend `GitWriteActions` and `CommitContextMenu`. Keep destructive actions behind native confirmations.

Run:

```bash
bun test src/lib/commitEditActions.test.js
bunx tsc --noEmit
```

Expected after implementation: PASS.

---

### Task 5: Rich Commit Details

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/git_commit_details.rs`
- Create: `src-tauri/src/git_commit_details_tests.rs`
- Modify: `src/lib/api.ts`
- Modify: `src/hooks/useRepositoryWorkspaceData.ts` or create `src/hooks/useCommitDetails.ts`
- Modify: `src/components/git/CommitInspector.tsx`
- Create: `src/lib/commitDetails.ts`
- Create: `src/lib/commitDetails.test.js`

**Interfaces:**
- Produce `getCommitDetails(path, commit)` returning full message, body, parents, refs/tags, signature status, and compare targets.
- Commit details UI exposes copy hash and compare/range diff entry points.

- [ ] **Step 1: Write failing Rust commit detail tests**

Tests cover full message/body, parent list for merge commit, refs/tags containing commit, signature status for unsigned commits, and range base calculation.

Run:

```bash
cd src-tauri && cargo test git_commit_details
```

Expected before implementation: FAIL.

- [ ] **Step 2: Implement Rust details command**

Use `git show`, `git for-each-ref`, and `git verify-commit` with mapped unsigned status.

Run:

```bash
cd src-tauri && cargo test git_commit_details
```

Expected after implementation: PASS.

- [ ] **Step 3: Write failing frontend details tests**

Add `src/lib/commitDetails.test.js` for formatting parents, refs, signature labels, and copy text.

Run:

```bash
bun test src/lib/commitDetails.test.js
```

Expected before implementation: FAIL.

- [ ] **Step 4: Implement query and UI**

Create `useCommitDetails` if needed to keep this out of legacy App data flow. Render in `CommitInspector`.

Run:

```bash
bun test src/lib/commitDetails.test.js
bunx tsc --noEmit
```

Expected after implementation: PASS.

---

### Task 6: File Tree Directory Operations

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/project_file_ops.rs`
- Create: `src-tauri/src/project_file_ops_tests.rs`
- Modify: `src/lib/api.ts`
- Modify: `src/hooks/useProjectFileActions.ts`
- Modify: `src/components/TreeContextMenu.tsx`
- Modify: `src/components/TreePanelContextMenuHost.tsx`
- Create: `src/lib/projectTreeActions.ts`
- Create: `src/lib/projectTreeActions.test.js`

**Interfaces:**
- Produce API wrappers: `createProjectDirectory`, `renameProjectPath`, `deleteProjectDirectory`, `revealProjectPath`, `appendGitignorePattern`.
- Tree context menu supports new folder, directory rename/delete, reveal in OS, copy relative path, ignore path/pattern.

- [ ] **Step 1: Write failing Rust directory operation tests**

Tests cover creating folders, renaming directories, rejecting directory escape paths, deleting non-empty dirs only with confirmation flag, revealing path command validation, and appending `.gitignore` without duplicate entries.

Run:

```bash
cd src-tauri && cargo test project_file_ops
```

Expected before implementation: FAIL.

- [ ] **Step 2: Implement Rust file operation commands**

Extract shared file operation logic from `src-tauri/src/lib.rs` where useful. Keep path validation cross-platform.

Run:

```bash
cd src-tauri && cargo test project_file_ops
```

Expected after implementation: PASS.

- [ ] **Step 3: Write failing frontend tree action tests**

Add `src/lib/projectTreeActions.test.js` for parent path defaults, `.gitignore` pattern normalization, and context menu availability for files vs directories.

Run:

```bash
bun test src/lib/projectTreeActions.test.js
```

Expected before implementation: FAIL.

- [ ] **Step 4: Implement hooks and context menu UI**

Extend `useProjectFileActions` and `TreeContextMenu`. Keep directory delete behind native confirmation.

Run:

```bash
bun test src/lib/projectTreeActions.test.js src/components/treePanelSelection.test.js
bunx tsc --noEmit
```

Expected after implementation: PASS.

---

## Final Verification

- [ ] Run frontend unit suite:

```bash
bun test
```

- [ ] Run TypeScript:

```bash
bunx tsc --noEmit
```

- [ ] Run frontend production build:

```bash
bun run build
```

- [ ] Run Rust tests:

```bash
cd src-tauri && cargo test
```

- [ ] Run whitespace check:

```bash
git diff --check
```

- [ ] Run UI verification through the real Tauri surface when available:

```bash
bun run tauri:dev
```

Manual checklist:
- Terminal search, outline, read-only, progress, and hidden-tab behavior.
- Tag create/delete/push from Git refs/log.
- Publish branch, upstream switch, remote manager, delete remote branch, force-with-lease confirmation.
- Amend/fixup/reword/squash and interactive rebase continuation banner.
- Commit details message/parents/refs/signature/copy/compare.
- File tree directory create/rename/delete/reveal/copy relative path/.gitignore.
