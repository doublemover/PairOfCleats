# Semantic recovery continuation — 2026-10-10

Historical author-workspace evidence for `codex/semantic-recovery-20261010`, based
on `d468621da9b72f5212b83689ce2ca54355a108a4`. The active queue remains in
[the roadmap](../roadmap.md); behavior is documented in
[the semantic guide](../guides/semantic-index.md).

## Implementation

- Reuse durable per-file completions and the sparse commit cursor after worker
  interruption; serialize control-store initialization and converge equivalent
  immutable cache publications without discarding the winning object.
- Account for temporary Stage1/Stage2 bundle encodings and completion replacement,
  including concurrent same-name writes and retained hard links. Remove duplicate
  source/mapping copies before returning their credits.
- Restore completion pins before startup cleanup; commit the manifest before
  sweeping at the startup/drained-worker barriers. Preserve the union of Stage1,
  Stage2 and embedded-source references. Validate all deletion paths first and
  reject links, including links into other objects within the same cache.
- Require current publication authority for pending and completed reconstruction.
  Enqueue/drain reconcile published descriptors and receipts before taking leases.
  Reconstruction observes the caller's cancellation signal.

The semantic producers and their meanings did not change; their version constants
remain unchanged. WASM decoding and host/module joins were outside this branch.

## Local evidence

Windows, PowerShell, Node `26.8.1` (the checkout's `.nvmrc` pin).
`npm run bootstrap:ci` completed in the isolated checkout using a task-owned npm
cache. Required patches/native activation passed and the readiness receipt was
saved. Optional `sharp` was not installed; no backend was substituted.

Focused fixtures ran via `node tests/run.js --lane all --match <selection>
--jobs 1 --timeout-ms 30000 --retries 0 --fail-fast`:

| Fixture | Passing duration |
| --- | ---: |
| `indexing/semantic/binding-work-publication-recovery` | 5.42 s |
| `indexing/semantic/cache-relocation` | 1.21 s |
| `indexing/semantic/embedded-cache` | 1.91 s |
| `indexing/semantic/interrupted-multi-worker-recovery` | 2.75 s |
| `indexing/semantic/phase-drain-production` | 19.9 s |
| `storage/semantic/first-stage-completion` | 2.31 s |
| `storage/semantic/frontier-control` | 277 ms |
| `storage/semantic/retained-cache-cleanup` | 1.45 s |
| `storage/semantic/transient-bundle-accounting` | 580 ms |

Initial fail-fast selections exposed fixture issues: embedded LSP assertions needed
explicit eager binding admission, and a name-only chunk edit did not trigger the
Stage2 rewrite being tested. Those fixtures were corrected and affected cases
rerun. All nine selected cases passed without larger deadlines or retries.
Fail-fast skips from earlier selections are not passing receipts.

The complete local pre-push gate passed: `npm run format`, `npm run config:budget`,
`npm run env:check`, generated-surfaces freshness, command-surface audit, workflow
contracts, the 39-test gate lane (one worker, 30-second per-test limit, no retries),
and `git diff --check`. The gate lane took 34.9 seconds total; its longest case took
3.54 seconds. There were no failures, timeouts or skips in that gate run.
`.testLogs` under the author's worktree are historical local receipts, not promised
clean-checkout files.

Final review also corrected the completion pin retained beside a same-source
Stage2 entry. After that change, formatting and the affected completion,
interrupted-worker, cleanup and semantic-handoff checks passed again (4/4,
6.90 seconds total). The full gate above preceded this final pin refinement;
only affected checks were repeated. Config budget was rechecked after renaming a
test payload field that its scanner mistook for CLI flags; no public knobs changed.
Markdown links, roadmap/contract checks and generated freshness also passed.

## Limits

Worker termination is a bounded worker-thread regression, not a machine/power-loss
qualification campaign. Shared-account admission covers the owned bundle and
semantic-copy paths; unrelated processes, remaining build writers and SQLite
journal growth are not an OS-level disk quota. Missing control stores can be
reconstructed from the current publication; corrupt stores still report errors,
and lost cancellation/retry history cannot be inferred from immutable artifacts.
No full index, benchmark campaign, remote push, PR creation, retarget or merge was
performed. Hosted CI has not evaluated this branch.
