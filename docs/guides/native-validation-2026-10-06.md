# Native validation checklist

This is an execution checklist for the grouped hardware validation session.
The [roadmap](../roadmap.md) owns priorities and completion status. Windows
command diagnosis is deliberately deferred until that session; a Linux check
does not establish its result.

## Windows command fallback

Baseline: `3e0796ccfe2b753a1bba16c860af6815a58f367f`,
[hosted run 37416912207](https://github.com/doublemover/PairOfCleats/actions/runs/37416912207).
The conditional wrapper's version branch succeeds; the literal server branch
exits 255. The old assertion omitted child stderr, so the exact transport defect
is still unproven. The updated regression retains bounded command, status,
signal, error code and output diagnostics.

Use native Windows and record the actual Node version; Node 24.21.0 matches CI.
In an isolated checkout, run:

```powershell
node --max-old-space-size=512 tests/shared/subprocess/windows-cmd.test.js
node --max-old-space-size=512 tests/shared/subprocess/command-invocation.test.js
```

The supplemental recovery packet also contains
`PairOfCleats-Native-Windows-Cmd-Diagnostic-3e0796cc.zip`. It is a standalone
three-file diagnostic containing the unchanged baseline resolver, `probe.cjs`
and its README. Extract it into a dedicated temporary folder and run:

```powershell
node --max-old-space-size=512 probe.cjs
```

It requires no npm install or network, uses only owned fixture files and the
installed Node/cmd.exe, and records `native-cmd-result-<time>.json`. It runs at
most 24 cases: spaced/plain paths, version and original-failure branches, and
every literal argument in first position. Each child is capped at two seconds;
the case budget is 25 seconds. An incomplete matrix is not a pass. Linux exits
without running the cases. Keep the ZIP/source hashes with the result.

Acceptance requires correct branch selection, no hidden shell errors, exact
empty/space/quote/backslash/percent/exclamation/caret/metacharacter arguments,
and both sync/async shared-runner checks. Keep line-break rejection and direct
executable argument behavior. Preserve the authored wrapper's control flow.
Capture the original failure before implementing a transport change, then rerun
the full native matrix against that exact change. Do not substitute emulation
or mark the existing Windows parent-signal skip as verified.

## Other session checks

- Exercise actual TUI rendering, keyboard interaction, cancellation and companion
  execution using the [TUI guide](tui.md); compile/test success alone is not GUI
  acceptance.
- Run the controlled [Node runtime comparison](../benchmarks/node-runtime-comparison.md)
  only with matched dependency/cache/workload settings. Preserve prior cloud
  resource stops as unmeasured results, not benchmark passes.
- Keep GPU/model/representative workload measurements distinct from these tiny
  CPU/CLI checks. Record the platform, runtime, source revision, actual outputs,
  failures, skipped cases and peak process-family resources for each result.
