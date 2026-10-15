# Changelog

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
