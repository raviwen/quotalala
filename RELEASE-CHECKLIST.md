# Release readiness

Last local verification: 2026-10-14. This is a preparation record, not a published release.

## Verified locally

- 25 offline unit/integration tests pass without real CLI calls.
- Mock Electron interface and production IPC startup checks pass.
- Source checks cover JavaScript syntax, 149 matching TR/EN translation keys, dependency pins, license inputs and recognizable secret patterns in Git candidates.
- A Windows x64 NSIS installer was built; 32 packaged source, asset and license files matched the working source at that build.
- No local sessions, memories, test fixtures or recognizable credential file names were included in the package.
- The installer is unsigned. Installation on a clean Windows user account has not been tested.

## Dependency status

The live npm audit on 2026-10-14 reports zero runtime advisories and eight moderate build/development advisories, with no high or critical advisories. These eight entries originate from one transitive chain: `electron-builder` → `@electron/get` → `global-agent` → `roarr` → `sprintf-js`.

The underlying [sprintf-js advisory](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) concerns denial of service from unbounded precision in format strings. These build dependencies are absent from the installed application's runtime dependency set. This does not make build-time exposure impossible. Keep build inputs trusted and revisit the upstream fix before release. No forced downgrade or unverified major override has been applied to suppress the report.

## GitHub checks

`.github/workflows/checks.yml` runs source checks, offline tests, mocked interface/startup checks and runtime auditing on Windows for pushes and pull requests. Full development auditing remains visible as a non-blocking step while the known upstream issue remains. A manual workflow run also builds and verifies an unsigned installer and retains it as a seven-day Actions artifact. It does not publish a GitHub Release.

The workflow has not yet run on GitHub at the time of this preparation record. Its first remote run must be checked after the authorized initial push.

## Before publishing

- Initial commit and public repository name `quotalala` were authorized by the maintainer; verify the remote and commit after sending.
- Run the GitHub checks after the first authorized push.
- Recheck advisories and decide whether to accept the remaining build-only issue for this release.
- Test installation, launch and uninstall on a clean Windows account; obtain permission before changing this development machine outside the project.
- Decide on Windows signing or clearly label the release as unsigned.
- Confirm release version, notes and artifact checksum before publishing.

Automatic model discovery and Gemini thinking-level controls remain pending as recorded in `AGENTS.md`. Quotalala does not bypass native CLI filesystem policies; the original Baktra access denial was not resolved by the outcome-validation fix.
