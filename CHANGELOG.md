# Changelog

## Unreleased

- Continue a task's worker in the same CLI session: follow-up answers resume the original session and send only the new instruction instead of re-sending goal, memory and shared results (the managed coordinator session is resumed the same way, and only new results are sent each round).
- Separate attempt and reply-round counters so a worker can answer a few coordinator questions without consuming its retry budget.
- Planning sends a compact level-to-model summary instead of the full model catalog on every call.
- A missing CLI, a signed-out account or a hard agent error now fails the board task instead of parking it for 30 minutes; only real quota limits wait.
- Transient "capacity"/"overloaded" errors are no longer classified as quota, and the default renewal wait matches the board's 30 minutes.
- Coordinator Claude model defaults to Sonnet instead of Opus (the strongest model is not the default).
- Task budgets (subtasks, attempts, reply rounds, management rounds, calls) are configurable in Settings with safe clamping.
- Board intake can use Gemini when the user has explicitly enabled it.
- Tray status and thinking-level labels are localized; Linux CI job runs the source checks and full offline test suite.

## 1.2.4 — 2026-10-19

- Stream Claude text and tool activity before completion using the official stream-json interface, keeping canonical final results separate.
- Show board planning, worker and review output, actual process IDs and work directories; preserve redacted partial output and early session IDs after failure.
- Use the configured board timeout and keep failed desks visible in the team room.
- Verify streaming, persistence, cancellation and the Electron output view with mock CLIs; no subscription prompts used.

## 1.2.0 — 2026-10-18

### Task Board & Concurrent Execution
- Background task board running up to 2 concurrent worker tasks with automatic queue management.
- Claude acts as intake planner and final reviewer for each card.

### Isolated Git Worktrees & Smart In-Memory Merging
- Work is isolated in dedicated git worktrees (`quotalala/<hash>`) under `~/.quotalala/worktrees/`.
- In-memory dry runs via `git merge-tree` verify mergeability before touching the working directory.
- Merges are allowed even with uncommitted working files as long as files do not intersect. Collisions safely pause for user action without data loss.

### Model Catalog & Thinking Controls
- Support for Claude 3.7 Sonnet / Opus, GPT-6.1 Sol / Luna / Astra, and custom reasoning/thinking levels (`none`, `low`, `medium`, `high`, `max`).
- Dropdown coordinator model selection in application settings.
- 429 quota exhaustion keeps the task and session preserved until reset time without agent swapping.

## 1.1.0 — 2026-10-15

### Claude-led teamwork

Claude now answers worker questions, requests focused consultations and assigns concrete revisions after the initial plan. Its final management response includes the synthesis. The animated team room shows actual task events, copyable messages and disabled-agent states without extra CLI calls. Optional background notifications open the relevant session.

### Execution and quota controls

Economic mode sends a task directly to one agent and tier. Coordinated runs are bounded to 3 management rounds, 8 tasks, 2 attempts per task and 20 prompt calls per run. Unsuccessful or duplicate results skip memory updates; summaries remain limited to 2000 characters. Usage counters describe local activity, not exact remaining provider quota.

Live stdout/stderr, process-tree cancellation, configurable timeouts, editable plan approval and continuation from incomplete steps preserve finished work and partial output. Agent claims are separated from observed file metadata and available command evidence. Optional verification uses quota; final synthesis is not an independent test.

### Local reliability and documentation

Single-instance forwarding, deferred project switching, unique atomic writes, interrupted-session recovery and summary-based history reduce storage conflicts and unnecessary reads. English, Turkish, German, Spanish and French READMEs include screenshots generated from the production renderer with synthetic data. Gemini remains disabled until explicit risk acceptance.

### Validation and limits

Offline tests cover coordination budgets, economic call counts, cancellation, timeout, process cleanup, continuation, plan validation and room state. Electron checks use mocked agents; no real subscription calls were made. Windows notification presentation depends on OS settings. macOS/Linux validation, automatic model discovery and Gemini thinking-level support remain pending. The installer remains unsigned and requires clean-account installation testing.

## 1.0.0 — 2026-10-14

Initial npm launcher release: launch the local Electron application from a project using `npx quotalala` or the globally installed `quotalala` command. Uses official authenticated CLIs and local project history/memory.

## Updating

After 1.1.0 is published, run `npx quotalala@latest`, or update a global installation with `npm install -g quotalala@latest`. This release does not add an in-app updater. Existing local sessions are retained; older saved plans keep their earlier execution flow.

Screenshots can be regenerated with `npm run screenshots`. This renders only synthetic data and writes images inside the repository; no agent CLI is loaded.
