# Quotalala 🎛️

**Quotalala** is a local desktop application built with Electron that automatically distributes a single prompt across Claude, ChatGPT (Codex), and Google Gemini subscription quotas without wasting usage limits. Claude serves as the main coordinator and synthesizer.

---

## Key Principles & Guarantees

- **No API Keys**: Only invokes installed and authenticated command-line tools on your machine (`claude -p`, `codex exec`, `agy`), with prompts sent through stdin.
- **Zero Credential Scraping**: Never reads, copies, or proxies user auth tokens or session secrets.
- **Secure Architecture**: Electron desktop app with `contextIsolation: true`, `nodeIntegration: false`, and sandboxed IPC communication.
- **Windows-Optimized**: Native handling of `.cmd`, `.bat`, and `.exe` binaries, piping prompts through `stdin` to eliminate command-line character escaping issues.
- **System Tray & Desktop Notifications**: Minimizes to system tray on close with real-time quota status on hover and Windows reminder notifications when quotas are approaching renewal.

---

## Architecture & Project Structure

```
quotalala/
├── src/
│   ├── main/                   # Electron main process
│   │   ├── main.js             # Window, system tray, native notifications
│   │   ├── preload.js          # Secure contextBridge IPC
│   │   ├── coordinator.js      # Claude task breakdown & synthesis
│   │   ├── quota.js            # Persistent quota & usage tracking
│   │   ├── cli-locator.js      # Cross-platform CLI binary resolution
│   │   └── agents/             # Modular agent plugins
│   │       ├── base-agent.js   # Base agent class
│   │       ├── claude.js       # Claude Code CLI module
│   │       ├── codex.js        # Codex / ChatGPT CLI module
│   │       └── gemini.js       # Google Gemini CLI module
│   └── renderer/               # Desktop UI (Single Screen)
│       ├── index.html          # Clean HTML layout
│       ├── style.css           # Modern dark-mode styling
│       ├── app.js              # IPC client logic & live streams
│       └── i18n/               # Multi-language translations
│           ├── tr.json         # Turkish (default)
│           └── en.json         # English
├── assets/                     # Application icons (.ico, .png)
├── test/                       # Diagnostics & tests
├── AGENTS.md                   # Agent system guidelines
├── LICENSE                     # MIT License
└── package.json
```

---

## Getting Started

### Prerequisites

- Node.js 22.12+ for development (tested on Node v24). The installed desktop application includes its own runtime.
- Local AI CLI tools installed and logged in:
  - **Claude Code**: `@anthropic-ai/claude-code` (`claude auth status`)
  - **Codex CLI**: `codex-cli` (`codex login status`)
  - **Antigravity CLI (Gemini)**: `agy` (optional, disabled by default; sign in interactively)

> [!WARNING]
> **Gemini / Antigravity CLI Notice**: Some accounts using Antigravity CLI automation have reportedly been restricted by Google. Gemini starts disabled and requires explicit acceptance of the risk notice on its card. Its stdin and optional effort capabilities are checked against the installed CLI's help; unverified flags are never used.

### Development Mode

```bash
# Install dependencies
npm ci

# Run desktop application
npm start
```

### Packaging Windows Installer

```bash
# Builds NSIS .exe installer in release/
npm run build
```

---

## History and project memory

Open a project once using the sidebar folder picker. The active project controls all task working directories, conversation history and project memory; there is no per-task path entry. Quotalala remembers the last project and lists recent folders. Its workspace preference is stored locally in `~/.quotalala/workspace.json`, independently of whether conversation saving is enabled.

To launch directly into a folder, use `Quotalala.exe --project "C:\path\to\project"` (development: `npm start -- --project "C:\path\to\project"`). Launching from a directory with common project markers also selects that directory. A fresh installer launch without a project asks you to open a folder. The application checks that the directory is readable before spending CLI quota; it does not bypass the CLI's own sandbox or policy. The sidebar shows Quotalala conversations for the active folder, rather than importing arbitrary Claude/Codex/Gemini transcripts.

The desktop layout has a conversation sidebar, compact agent cards, a central task composer and a project-memory panel. Outputs, activity timeline and diagnostic logs have separate tabs. `Ctrl+N` opens a new conversation and `Ctrl+Enter` sends a task from the composer.

Each coordinated run records its prompt, plan, agent/model choices, outputs, structured logs and status. Open, rename, delete or continue sessions from the project-grouped sidebar. Continuing uses an exact native CLI session ID when supported; if that session is unavailable, project memory provides the context. Resume support is verified using at most two help commands per CLI per application run. Claude and Codex support was verified locally; `agy` was unavailable on the development machine.

Data stays in `~/.quotalala/sessions/` and `~/.quotalala/memory/` as JSON. Claude updates a bounded 2000-character project summary after each saved run, using the light model tier. You can edit this summary, reset a project's memory, turn off saving, or delete all sessions and memories in Settings. Disabling saving also skips automatic memory generation; explicitly saving an edited summary still stores it. CLI tools may independently retain their own transcripts.

Recognizable API keys, bearer tokens, JWTs and labeled secrets are masked before Quotalala writes records. Redaction is pattern based and cannot recognize every possible unlabeled secret; review raw diagnostics before sharing them. Quota error history remains capped at 200 characters per entry, independently of full session output.

Logs support severity and agent filters, text selection, Ctrl+C, a native Copy/Select All context menu, row copy controls and Copy All. Error cards provide a localized explanation, suggested fix and copyable raw output. Task outputs have the same selection/copy controls. All generated content is inserted as text rather than executable HTML.

Models come from `~/.quotalala/models.json`; Settings exposes the list with required source metadata. The planner selects a tier and the backend resolves it to a model. Preview models are excluded from default choices. An unavailable model falls back to the CLI default with a warning. Automatic model catalog discovery is still pending.

Gemini has no bundled model names because they could not be verified on the development machine. Add a model with an actual CLI/local-source reference after verifying your `agy` installation, or use its default model. Invalid local model catalogs fall back to the validated bundled list without replacing your file.

Sessions also retain a structured activity timeline: planning, assignments with model/tier/reason, completion or failure, output transfers, quota-driven agent changes and final review. Expand an event to inspect and copy its input/output; related assignment and completion records are linked without duplicating payloads. Events appear live and are saved immediately with the existing secret masking and history preferences. Older sessions without activity records show an empty timeline notice.

Planning receives project memory plus at most 20 short activity headings from that project. When continuing a session, its own timeline headings take priority within that same 20-event budget. Complete historical event inputs and outputs are never included in this activity context.

## Validation

Task completion is evaluated separately from a successful CLI exit. Codex command failures are retained alongside the final answer. Project review tasks require file/line references and, when command telemetry is available, a successful file-read command. A policy-denied task is shown as blocked and does not increase the completed-job counter. Remaining file-review tasks are skipped after a shared access denial; Quotalala does not automatically route around the policy with another agent or disable CLI protections. This detects common failure reports and command evidence; it is not a proof that every finding is correct.

```bash
npm test         # Offline unit/integration tests, mocked CLIs
npm run test:ui  # Electron UI tests, mocked CLIs and local fixture storage
npm run test:startup # Production IPC startup with local fixtures
npm run check    # Git candidate files, syntax, translations, lockfile and secret patterns
npm run check:package -- path/to/app.asar # Compare a built package with current source
```

Fixtures and screenshots stay in `.test-artifacts/`, which is ignored by Git. The opt-in `node test/e2e-real.js --approved` performs one short real coordinated flow and writes to the normal local store. Run it only after permission to use CLI quota and create records outside the repository. Do not run live diagnostics automatically on startup.

## Release preparation

Windows source checks and mocked Electron tests are configured in `.github/workflows/checks.yml`. A manual Actions run also builds and verifies an unsigned installer for download, without publishing a Release. See [RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md) for verified checks, known build dependency advisories and the remaining release steps.

## License

MIT © Quotalala Contributors
