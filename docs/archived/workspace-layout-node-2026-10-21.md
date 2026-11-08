# Workspace layout and Node runtime update — 2026-10-21

This batch continues `codex/pr557-audit-repairs-20261012` from
`9a2380368131c3bca35d1a05b46e9e7f90f9467d`. Scope is Windows contributor setup
and scratch-path ownership. Broader deep-suite, native TUI, issue and release
qualification remain paused; WSL was not launched.

## Runtime

The application minimum is `>=26.12.1 <27`; `.nvmrc`, all application CI pins and
native dependency cache keys select exactly 26.12.1. Dependency-free preflight,
bootstrap admission, native rebuild and editor launch contracts enforce the same
minimum. Regression cases reject 26.12.0, older majors/minors and prereleases;
supported later stable 26.x versions remain admitted.

The installed Windows x64 executable is `C:/nvm4w/nodejs/node.exe`. Its SHA-256
`1c63f1417e2e26d83ca9a9ec1d548524ab1305bc7209d90ebca56257ff0d84ed`
matches the executable entry in the official
[26.12.1 checksum manifest](https://nodejs.org/dist/v26.12.1/SHASUMS256.txt).
Earlier 26.10.0 crash attribution and suite receipts keep their original version
and source identities; they do not qualify this new runtime.

## Scratch ownership

The root `temp/` contents were relocated into ignored `.tmp/`, including the
registered diagnostic worktree, whose Git registration was repaired. Current
owners write fixtures and coverage under `.tmp/dev/tests/`, benchmarks under
`.tmp/dev/benchmarks/`, CI defaults under `.tmp/dev/ci/`, and task evidence under
`.tmp/tasks/`. Profiling and clone-detector outputs also use `.tmp/`.

Git and search ignores retain legacy roots. Formatting, config/environment
inventory and default indexing exclude `.tmp/` so saved source snapshots do not
become live inputs. Explicit indexing default-skip overrides remain covered.
Import-report discovery prefers current paths while retaining read-only legacy
report discovery; it does not recreate old roots. Historical receipt paths and
synthetic ancestor-path controls are preserved.

## Verification

- Locked `npm run bootstrap:ci`: exit 0 on Node 26.12.1, Windows x64, ABI 147;
  37 required packages verified and 33 parser routes activated. The complete
  bootstrap log contains zero warning/error/failure lines; npm reports zero
  known vulnerabilities. Setup activation is distinct from full qualification.
- Sixteen focused fixtures pass: seven path/ignore/inventory controls, four
  related CLI/tokenizer/documentation cases, and five runtime/readiness/release
  controls. Each uses one job/thread, a 30-second deadline, zero retries and
  native-status redo disabled. No final failure, timeout or skip remains.
- The editor fixture initially failed because it compared the canonical launcher
  result with NVM's directory alias in `process.execPath`. Production already
  calls `fs.realpathSync`; the assertion now requires that same canonical
  executable. The corrected fixture passes on the actual NVM launch and retains
  incompatible-version, untrusted-workspace, invalid-probe and missing-runtime
  negatives. The initial failure receipt is preserved, not counted as a pass.
- The full pre-push gate passes: formatting, config budget, environment checks,
  generated-surface freshness, command-surface contract, workflow contract, all
  40 gate fixtures and `git diff --check`. All gate fixtures finish below 30
  seconds, with zero failures/timeouts/skips and no retries/native-status redo.

These checks cover the changed setup and path owners. They do not qualify the
entire deep suite, performance, real models, optional backends or releases on
26.12.1. Those broader tasks remain paused.
The author-workspace receipts live under
`.tmp/tasks/workspace-cleanup-20261021/`; these ignored logs are historical
working evidence and are not promised in clean checkouts. Original failed
attempts and the cancelled 26.10.0 bootstrap remain separate from acceptance.
