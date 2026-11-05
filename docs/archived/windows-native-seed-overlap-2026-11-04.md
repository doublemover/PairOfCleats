# Windows native seed and terminal lifetime — November 4, 2026

At source `f0ae858`, Windows native inspection reports 33 passes, one failure
and one timeout. Published search completes its actual query but exhausts the
26-second PTY capture after an 18.6-second seed. Snapshot creation completes
its actual CLI operation and assertions near the 30-second process deadline.
Neither failure has an access-violation status. The [machine receipt](windows-native-seed-overlap-2026-11-04.json)
retains both original child commands/statuses, logs, phases, native identities,
seed outcomes and terminal-restoration witnesses from hosted artifact13385211669.

A bounded diagnostic records timer allocation stacks. At fixture settlement,
the only referenced timer belongs to installed node-pty1.1.0
`ConoutConnection._drainDataAndClose`: its deliberate 1,000ms output drain
expires and the process exits. This demonstrates a crowded aggregate fixture
lifetime; it does not demonstrate a timer leak. The drain and native ownership
patches remain unchanged. The earlier timed-out diagnostic remains recorded.

On Windows, the canonical full seed now signals independent terminal startup
when its final Stage4 begins. Console initialization, repository selection,
command-catalog rendering and form entry can overlap that remaining setup.
The complete build result, original native-backend checks and canonical
snapshot preparation still finish before every read, preview or launch.
The status signal only schedules work; it grants no generation authority.
Preparation failures propagate through the original cleanup boundary.

Every case retains a fresh repository/cache, full native backends, original
assertions, actual binary/supervisor/public CLI, descendant reaping and terminal
restoration. Fixture/PTY/native/seed bounds remain30s/26s/18s/20s. One job,
one indexing thread, zero retries and disabled native-status redo remain.
Non-Windows fixture execution is unchanged. Local Rust compilation succeeds
with the installed pinned toolchain via `cargo +1.99.1 build --locked`; no
Node, dependency, backend, public contract or drain interval changes.

Both original failures pass in fresh local processes (29.5s and29.8s). Their
proximity to the outer limit remains explicit; this receipt makes no isolated
latency-speedup claim. All nine other affected full-seed cases also pass (23.3–25.9s), preserving
all 11 cases with no failures, timeouts, skips or retries. All eight publication
checks pass, including all 41 gate cases. Hosted final-candidate acceptance
remains pending.

Local `.tmp/` and `.testLogs/` paths in the receipt are historical workspace
evidence, not files promised by a clean checkout. Tantivy native qualification
remains deferred by user decision.
