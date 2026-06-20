# Agentic Development Guidelines

These guidelines keep this repository easy for humans and AI coding agents to
change safely.

## External References

- AGENTS.md format: https://agents.md/
- OpenAI Codex repository instructions example: https://github.com/openai/codex/blob/main/AGENTS.md
- GitHub analysis of effective agents.md files: https://github.blog/ai-and-ml/github-copilot/how-to-write-a-great-agents-md-lessons-from-over-2500-repositories/
- Claude Code best practices: https://code.claude.com/docs/en/best-practices
- Research on AGENTS.md and coding agent efficiency: https://arxiv.org/abs/2606.15828

## Repository Contract

- Keep root `AGENTS.md` concise, concrete, and command-oriented. It is loaded
  at startup, so every line should prevent a real mistake.
- Use nested `AGENTS.md` files only when a subtree has materially different
  commands, ownership, risk, or coding rules.
- Put commands, project structure, testing, code style, Git workflow, and
  boundaries in agent-facing instructions.
- Prefer examples and exact commands over abstract advice.
- Keep long explanations, rationale, and playbooks in `docs/`, then link from
  `AGENTS.md` only when the guidance is broadly useful.

## Work Loop

1. Inspect current state with `git status --short --branch -uall`.
2. Read the nearest `AGENTS.md` files that govern files being changed.
3. For non-trivial work, explore relevant code before planning or editing.
4. State the intended change when edits will touch multiple files or user-facing
   behavior.
5. Make the smallest coherent change.
6. Run the cheapest relevant verification first, then broader checks when risk
   warrants it.
7. Report the evidence: command names, pass/fail status, and any remaining risk.

## Verification Culture

AI-assisted work should have an observable pass/fail signal.

- TypeScript changes: `bunx tsc --noEmit`.
- Frontend runtime changes: `bun run build`; use visual QA for visible UI behavior.
- Rust/Tauri command changes: `cd src-tauri && cargo test`.
- Release or packaging changes: `bun run tauri:build` or `just run-release`.
- Any handoff: `git diff --check`.

When no automated check exists, add a focused test or describe the manual check
that was performed through the real app surface.

## Agent-Friendly Code

- Keep modules small and named by responsibility. A giant file makes both human
  review and agent edits worse.
- Preserve typed boundaries between React state, Tauri command wrappers, Rust
  command payloads, Git models, file tree models, editor state, and terminal
  state.
- Put heavy or cross-platform filesystem/Git work behind Rust commands instead
  of repeating shell logic in UI components.
- Make derived state explicit and cheap. Large trees, diffs, commit lists, and
  editor searches need virtualization, debouncing, or backend support.
- Prefer deterministic APIs and fixtures over UI-only behavior that cannot be
  tested.

## Boundaries

- Do not touch secrets, personal config, screenshots, generated build products,
  or unrelated files.
- Ask before adding production dependencies, changing CI/release workflows,
  changing package managers, altering database/schema-like persistent formats,
  or running destructive commands.
- Do not commit or push unless the user explicitly asks.
- Do not hide failures by weakening checks, deleting failing tests, or adding
  suppressions without a root-cause explanation.

## Maintaining These Rules

Update agent-facing instructions when a mistake repeats or a new workflow
becomes stable. Remove rules that are self-evident from the code or no longer
change agent behavior. Treat these files like code: small, reviewed, and kept in
sync with the actual project.
