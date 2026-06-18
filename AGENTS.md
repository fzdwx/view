# AGENTS.md

## Project

View is a Tauri 2 desktop Git client for log, diff, worktree, file browsing,
editing, search, and an embedded terminal.

- Frontend: React 19, Vite, TanStack Query/Virtual.
- Backend: Rust Tauri commands under `src-tauri/src/lib.rs`.
- Diff rendering uses `@pierre/diffs`.
- Tree rendering uses `@pierre/trees`.
- Settings live in `src/lib/settings*` and `src/components/settings`.
- Project persistence lives in `src/lib/projects.ts`.
- Tauri command wrappers belong in `src/lib/api.ts`; do not call `invoke`
  directly from React components.

## Commands

- Install dependencies: `pnpm install`
- Frontend dev server only: `pnpm dev`
- Tauri dev app: `pnpm tauri dev`
- Frontend build/typecheck: `pnpm build`
- Typecheck only: `pnpm exec tsc --noEmit`
- Tauri release build: `pnpm tauri:build`
- Build and run release binary: `just run-release`
- Backward-compatible typo alias: `just run-realese`
- Rust tests: `cd src-tauri && cargo test`
- Whitespace check before finishing: `git diff --check`

## Architecture

- Treat `src/App.tsx` as a legacy orchestration shell. Do not add substantial
  new UI, parser, editor, git, terminal, or settings logic there.
- When touching `src/App.tsx`, prefer extracting nearby cohesive code into
  named modules instead of expanding the file.
- Put reusable UI in `src/components/<FeatureName>.tsx` or
  `src/components/<feature>/`.
- Put pure parsing, formatting, tree shaping, query helpers, and data transforms
  in `src/lib/`.
- For a feature with both UI and logic, create `src/features/<feature>/` once it
  would otherwise span multiple component/lib files.
- Keep module names responsibility-based, not bucket names like `utils.ts` or
  `helpers.ts`.
- Keep tests, fixtures, and type docs near the module that owns the invariant
  when extracting code from a large file.

## Agent Workflow

- For multi-file or risky work, inspect first, state the intended change, then
  edit. Small mechanical fixes can be made directly.
- Before editing, identify the cheapest verification signal that proves the
  change worked. Prefer deterministic commands over visual inspection alone.
- Keep this file short and operational. Put longer AI-collaboration guidance in
  `docs/agentic-development.md` instead of expanding the startup context.
- If an agent repeats a mistake, fix the narrow rule here or in a deeper
  `AGENTS.md`; do not add broad advice that the code already makes obvious.

## React and TypeScript

- Use named exports. Type-only imports must use `import type`.
- Avoid `any`, non-null assertions, `@ts-ignore`, and `@ts-expect-error`.
- Prefer readonly props and data shapes unless mutation is the point.
- Components should be leaf-focused and small enough to review quickly. Split
  hooks, pure helpers, and subcomponents before a file becomes hard to scan.
- Keep render paths cheap. Use TanStack Virtual for large lists/trees and avoid
  synchronous full-file work on every keystroke.
- Treat panel size and drag-preview state as layout state, not content state.
  Resizing must not force heavy trees, commit lists, or diff content to
  re-render every pointermove; pass layout sizes separately from large data
  objects and prefer local draft size during drag with commit-on-release when
  that keeps interactions responsive.
- Query keys must include every identity that changes the fetched data.
- When using `placeholderData: keepPreviousData`, validate the returned payload
  against the current project/path/commit/status before rendering it.
- Do not store derived UI state that can be computed from canonical project,
  commit, file, or draft state unless it prevents real performance work.
- Search, replace, diff, and tree operations over large files or many paths
  should be pushed to Rust or made incremental/debounced.

## Tauri and Rust

- Tauri commands should normalize repository-relative paths and reject paths
  escaping the repository root.
- Cross-platform file operations must account for Windows-invalid names,
  separators, reserved device names, and absolute-path shortcuts.
- Keep Git command execution centralized in Rust helpers; do not duplicate shell
  command assembly across commands.
- Return typed structs to the frontend instead of stringly-typed ad hoc JSON.
- Library code should return `Result<_, String>` consistently with the existing
  code; do not panic for recoverable user or Git failures.
- If a frontend feature depends on Git status, consider staged, unstaged,
  untracked, renamed, deleted, conflicted, local branch, remote branch, and
  worktree cases.

## UI

- This is a desktop work tool, not a marketing page. Prefer dense, restrained,
  native-feeling layouts.
- Reuse existing design tokens and the Pierre dark theme direction. Avoid
  introducing a new one-off palette.
- Use existing panels before creating new chrome. Git, project, terminal,
  editor, settings, tree, and diff surfaces should feel like one application.
- For icon buttons, use the existing icon library and provide accessible labels
  or titles when meaning is not obvious.
- Resize interactions should feel as direct as the file tree splitter. If a
  panel drag visibly lags behind the pointer, treat it as a bug and first check
  whether layout updates are coupled to expensive content renders or
  persistence.
- After UI changes, drive the actual app surface and check scrolling, focus,
  keyboard shortcuts, resize handles, and dark-theme contrast.
- `:root` sets `text-rendering: optimizeLegibility` which causes ligature
  and kerning artifacts on small monospace text. Override to
  `text-rendering: auto` on containers that render dense monospace
  (editor, diff view, file preview, terminal, commit list, file tree).
  Keep `-webkit-font-smoothing: antialiased` (inherited from `:root`) on
  scrollable containers; do not override those containers to `auto` or
  `subpixel-antialiased`. Antialiasing is position-independent and stable
  during scroll, while subpixel rendering depends on integer pixel positions
  and can blur in one scroll direction. Reserve `subpixel-antialiased` for
  static text only (e.g., settings font preview).

## Verification

Run the smallest relevant set first, then the broader gate before finishing:

- TypeScript-only changes: `pnpm exec tsc --noEmit`
- Frontend/runtime UI changes: `pnpm build`
- Rust/Tauri changes: `cd src-tauri && cargo test`
- Packaging or release changes: `pnpm tauri:build`
- Any change before handoff: `git diff --check`

For visible UI behavior, compile success is not enough. Start the dev app or the
release binary and verify the changed screen through the real surface when the
environment allows it.

## Git Safety

- Start by checking `git status --short --branch -uall`.
- The working tree may contain user changes. Never revert, overwrite, stage, or
  delete changes you did not make unless the user explicitly asks.
- Keep commits atomic and do not commit or push unless the user explicitly asks.
- Ask before adding production dependencies, changing CI/release configuration,
  or running destructive Git/file operations.
- Do not include screenshots, local debug files, build products, or unrelated
  files in commits.
- Preserve existing public behavior while refactoring; behavior changes need an
  explicit user request or a clearly stated bug fix.
