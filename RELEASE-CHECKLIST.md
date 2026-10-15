# Release readiness

Last local verification: 2026-10-15. Release target: **1.1.0**. Registry publication is a separate explicit step; verify the npm version and archive integrity after publishing.

## Verified for 1.1.0

- 70 offline unit/integration tests pass, including economic call counts, bounded coordination, cancellation, process-tree cleanup, timeout, retained partial results, continuation and plan validation. No real agent CLI calls were made.
- Mock Electron UI, production single-instance/recovery checks and the generated npm application's production startup pass. Both motion preferences are explicitly tested, independent of Windows host defaults.
- Source checks cover 45 JavaScript files, 232 matching TR/EN translation keys, pinned dependencies, README links, PNG signatures and recognizable secret patterns. Runtime audit on 2026-10-15 reports zero vulnerabilities.
- The generated npm archive contains exactly 54 approved files, including all five READMEs, CHANGELOG and three production-renderer screenshots with synthetic data. Tests, build tools, credentials and user sessions are excluded.
- No new dependency, global install or automatic in-app updater was added. Existing local sessions remain available.

## Earlier installer verification

A Windows x64 NSIS installer was built on 2026-10-14 and its 32 source/asset/license files matched the source at that time. That earlier installer does not validate the current 1.1.0 source. A new installer build, clean Windows account installation/uninstallation and signing decision remain pending. The installer is unsigned; no GitHub Release has been published.

## Dependency status

The npm audit snapshot from 2026-10-14 reported eight moderate build/development advisories and zero runtime advisories. Those development entries originated from `electron-builder` → `@electron/get` → `global-agent` → `roarr` → `sprintf-js`. This is a dated snapshot, not a new full development audit.

The [sprintf-js advisory](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) concerns denial of service from unbounded precision in format strings. The build dependencies are absent from the installed application's runtime dependency set. Recheck the upstream fix before an installer release; no forced downgrade or unverified major override was applied.

## GitHub checks

`.github/workflows/checks.yml` runs source checks, offline tests, mocked interface/startup checks and runtime auditing on Windows. A manual run also builds and verifies an unsigned installer and retains a seven-day Actions artifact without publishing a Release.

The run for `59c28e1` failed because the hosted Windows machine defaulted to reduced motion while the animation test assumed animations were enabled. The test now explicitly selects both `no-preference` and `reduce`; local verification passes. The next pushed revision must complete its remote checks before publication.

## npm release procedure

`quotalala@1.0.0` was published on 2026-10-14 with maintainer authorization. Version 1.1.0 adds the features documented in [CHANGELOG.md](CHANGELOG.md). Publish the generated archive from `npm run pack:cli`, never the root development manifest. The launcher pins the tested Electron runtime and requires Windows and Node.js 22.12+.

1. Confirm the pushed revision passes GitHub checks.
2. Build the final archive and run the packed application startup check.
3. Publish that exact archive with npm's normal maintainer authentication.
4. Verify registry version, `latest` tag and archive integrity against the local file.
5. Update with `npx quotalala@latest` or `npm install -g quotalala@latest`.

Automatic model discovery, Gemini thinking-level controls, macOS/Linux validation and OS-level notification presentation remain platform/release limitations. CLI filesystem restrictions remain in effect.
