<p align="center">
  <img src="assets/icon.png" alt="Quotalala Q logo" width="104" height="104">
</p>
<h1 align="center">Quotalala</h1>
<p align="center">One prompt. Your project. Claude, Codex and optional Gemini.</p>
<p align="center">
  <strong>🇬🇧 English</strong> · <a href="README.tr.md">🇹🇷 Türkçe</a> · <a href="README.de.md">🇩🇪 Deutsch</a> · <a href="README.es.md">🇪🇸 Español</a> · <a href="README.fr.md">🇫🇷 Français</a>
</p>
<p align="center">
  <a href="https://www.npmjs.com/package/quotalala">npm</a> · <a href="LICENSE">MIT</a> · Windows · Node.js 22.12+
</p>

Quotalala is a local Electron desktop app that coordinates your authenticated AI CLIs. Open it from your project, write one prompt, and let Claude plan the work, assign tasks and review the results. That project's saved conversations and memory load automatically.

## What is new in 1.1.0

Claude manages follow-up questions, consultations and focused revisions. The team room shows real task events without extra agent calls.

Economic mode, editable plan approval, live output, Stop, configurable timeouts and continuation from incomplete steps are included. Results distinguish agent claims from observed evidence.

Coordination is bounded to 3 management rounds, 8 tasks, 2 attempts per task and 20 prompt calls per run. Usage counters are local activity records, not token counts or exact subscription balances.

See [release notes](CHANGELOG.md). Update with `npx quotalala@latest` or `npm install -g quotalala@latest`. These features require 1.1.0 or later; npm 1.0.0 has the earlier feature set. No automatic in-app update is installed.

## Screenshots

Production Electron interface with synthetic project data and messages; no subscription calls or private project history. The interface supports English and Turkish.

![Project workspace and live team room](assets/screenshots/workspace-en.png)

<details>
<summary>Editable plan with agent and tier selection</summary>

![Editable plan with agent and tier selection](assets/screenshots/plan-approval-en.png)

</details>

<details>
<summary>Turkish team room</summary>

![Turkish team room](assets/screenshots/team-room-tr.png)

</details>

## Start in your project

Open a terminal **inside the project you want to work on**:

```powershell
npx quotalala
```

Or install once and use the short command:

```powershell
npm install -g quotalala
quotalala
```

The current folder becomes the agents' working directory, even without `.git` or a project manifest. To open another folder:

```powershell
quotalala --project "C:\projects\my-app"
```

**Requirements:** Windows, Node.js 22.12+ and installed, signed-in `claude` and `codex` CLIs. Check sign-in with `claude auth status` and `codex login status`. The optional Gemini agent uses `agy`. The first npm installation downloads Electron; a separate Quotalala installer and native compilation are unnecessary. This command opens a desktop window.

## What changes

| Working manually | With Quotalala |
| --- | --- |
| Repeat the same context across agents | Send one prompt; Claude creates a plan |
| Decide who should do each task | Tasks include an agent, model tier and reason |
| Copy results between tools | The coordinator passes task outputs along |
| Reconstruct where you left off | Open the project's conversations, timeline and editable memory |

1. **Plan:** Claude breaks the prompt into tasks using local quota state and project context.
2. **Execute:** Tasks go to Claude, Codex or enabled Gemini. Quota errors can trigger a handoff; unavailable models fall back to the CLI default.
3. **Review:** Claude combines and checks the results. The timeline shows assignments, transfers and failures, with expandable inputs and outputs.

Local usage and quota-error records guide routing; they are not a live provider quota meter or a guarantee of lower usage.

## A little team room

The main screen now has a small animated office: Claude leads, Codex builds, and optional Gemini researches. Desks react to actual task events—working, waiting for an answer, receiving a reply, finishing or stopping. Click a speech bubble or the delivery strip to inspect and copy the real message. Expand **Connections and agent details** for the existing health/model controls, or collapse the room to save space.

The room makes **no additional CLI calls**. Agent questions and answers still flow automatically through Claude's existing coordination loop. Disabled Gemini stays off, recorded sessions are labeled, and work animations stop on cancellation and in history. Reduced-motion preferences are respected.

When the app is in the background, quiet desktop notifications announce a finished task, an incomplete/blocked result or a plan awaiting your approval. Clicking opens the relevant session without starting or repeating work. Agent-to-agent chatter and user cancellations do not produce desktop alerts. Toggle **Task notifications** in Settings. Notifications contain generic text, not prompts or agent responses, and their delivery depends on operating-system notification settings.

## Claude manages the team

In Coordinated mode, Claude now remains in charge after the initial plan. Workers can return a result or ask a question. Claude evaluates independent results together, answers waiting agents, assigns a focused consultation to another enabled agent, or creates a specific revision task. The answer then reaches the agent that needs it. Questions, decisions and replies appear in **Team conversation** and the timeline, with selectable and copyable text.

The final management response contains the synthesis, avoiding a separate synthesis call. Coordination uses the light tier and at most **3 management rounds**. All initial, consultation and revision tasks share the existing **8-task / 2-attempt-per-task / 20-call** limits; asking a question and responding to its answer both consume attempts. Completed work is retained; revisions have separate steps. With plan preview enabled, later work and replies also return for editable approval.

To limit context costs, each handoff includes at most 3 selected output excerpts of up to 1600 characters each. Managed calls use fresh CLI conversations with the required context, rather than replaying an entire native transcript. Full outputs remain in local history. Large results can be truncated in shared context, and hitting a budget leaves a partial result rather than claiming completion. Older saved plans keep their earlier execution behavior. Gemini still requires explicit enablement and risk acceptance. Lower usage is an objective, not a provider quota guarantee.

## Execution controls and evidence

- **Economic mode:** choose one agent and tier to run directly. A successful run uses one prompt call; planning, synthesis, memory updates and additional verification are skipped. If Claude coordination is unavailable, use this mode with another available agent. Model/session fallback can add one attempt.
- **Plan approval:** optionally preview the plan, edit titles/prompts/reasons and agent/tier choices, or remove tasks. The backend validates the edited plan and current agent availability; model names still come from the verified catalog.
- **Limits:** at most 8 subtasks, 2 prompt attempts per task (including model fallback and handoff), and 20 prompt calls per run. Repeated failed operations are skipped. Set the per-call timeout from 1 to 1800 seconds (default 180); help discovery has its own 10-second timeout.
- **Live output and Stop:** stdout/stderr are displayed through restricted IPC with selectable, copyable text. Stop terminates the process tree, skips queued work and records cancellation separately from failure. Completed tasks and partial output remain saved. Output appears when the CLI emits it; some CLI formats buffer until completion.
- **Continue:** cancelled, failed or interrupted work reuses its saved plan and successful outputs; only missing steps run. This cannot undo side effects from a partly completed step, so inspect partial changes before retrying it. A completed conversation accepts a new follow-up prompt.
- **Evidence:** a zero exit code alone does not establish success. Agent-reported results and independently unverified results are labeled separately. The result shows locally observed file metadata changes, agent-supplied file/line references, and command/exit-code events exposed by the CLI (currently Codex). Review tasks require file/line evidence; general explanations do not. Claude synthesis is explicitly not an independent test. Optional additional verification uses quota and reports its output and observed command evidence without claiming universal test coverage.
- **Memory and history:** only successful new output can trigger a memory call; exact duplicate outputs are remembered across sessions using at most 256 digests. Summaries remain capped at 2000 characters. History lists use small summary records, loading full outputs on demand. Legacy records migrate once; extremely large histories may take time on the first migration.
- **One desktop instance:** a second launch forwards its project request to the existing window. While a task is active, the request waits; the running task keeps its original working directory. Unique temporary files protect atomic JSON writes; interrupted sessions are marked on startup and can be continued from history.

File metadata is observational evidence, not a content diff or proof that the agent alone made a change. Claude/agy checks without structured execution events remain agent claims. Live output is checkpointed periodically; an abrupt crash may lose the latest second of streamed text. Saving must be enabled for recovery. Windows process-tree cleanup is tested; macOS/Linux behavior still needs platform testing.

## Your project remembers

- Conversations are grouped by project. Open, rename, delete or continue a session.
- After successful coordinated runs with new output, Claude updates an editable project summary of up to **2000 characters**. Planning also receives at most **20 activity headings**.
- Outputs and logs can be selected and copied. Filter logs by severity or agent; error cards show a suggested fix and copyable raw output.

`Ctrl+N` starts a conversation. `Ctrl+Enter` sends the prompt. The interface supports Turkish and English; these README translations do not add interface languages.

## Local storage and permissions

No API keys, credential-file scraping, proxies or account sharing. Quotalala sends prompts through stdin to official CLIs using your own signed-in accounts. Sessions and memory are JSON in `~/.quotalala/sessions/` and `~/.quotalala/memory/`. Settings can disable saving or clear history; project memory can be edited or reset. Native CLIs may retain their own transcripts.

Recognizable keys and tokens are masked before saving. Pattern-based masking cannot detect every secret; review diagnostics before sharing them. Opening a folder does not bypass CLI sandbox policies. A successful CLI exit is not sufficient to mark a blocked review as completed.

> **Gemini is disabled by default.** Its card requires acceptance of a risk notice before enabling `agy`, explaining reported account restrictions related to automated use. No Gemini model names ship without verification on the development machine.

## Desktop installer

The Windows NSIS installer is also supported as a build target and does not require Node.js:

```powershell
& "C:\path\to\Quotalala.exe" --project "C:\projects\my-app"
```

Launching the executable from a folder with a marker such as `.git`, `AGENTS.md` or `package.json` detects that project. Otherwise it restores the last project. The sidebar lets you switch projects or choose a first folder. No installer Release has been published yet; the locally verified installer is unsigned.

<details>
<summary><strong>Development, tests and packaging</strong></summary>

Run these in the cloned Quotalala repository:

```powershell
npm ci
npm start
npm test
npm run test:ui
npm run test:startup
npm run test:instance
npm run check
npm run pack:cli
npm run build -- --win --publish never
```

Use `npm start -- --project "C:\projects\my-app"` to develop against another project. Tests use mocked CLIs and local fixtures. Real quota tests require explicit permission; see [AGENTS.md](AGENTS.md).

`pack:cli` creates a standalone npm archive with a pinned Electron dependency and validates its file list. Publish the generated archive, not the root development manifest. NSIS packaging uses Electron as a development dependency. Neither command publishes automatically.

Models live in `~/.quotalala/models.json`, with required source metadata, editable in Settings. Preview models are excluded from default choices. Automatic model discovery and Gemini thinking-level controls remain pending. macOS and Linux support is planned.

See [RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md) for release checks and known build dependency advisories. The app uses a sandboxed renderer, context isolation and a restricted IPC bridge; backend logic lives in `src/main/`, interface files in `src/renderer/`.

</details>

## License

[MIT](LICENSE) · Quotalala Contributors
