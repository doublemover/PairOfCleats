# Stage1 watchdog recovery — 2026-10-11

This is a focused backport based on campaign commit
`d468621da9b72f5212b83689ce2ca54355a108a4`. It does not incorporate the later
semantic recovery or native-language branches.

## Incident and repair

The SSR run was reported to exit at 2026-10-11 00:20:48 UTC, at 4933/8249 files,
with `ReferenceError: queueDelaySummary is not defined`. Both index processes
were reported exited. The reported source snapshot is
`11f5a004e9569f07c5ceccd3fedb21ac8ae51f76`; 4912 durable completion records,
checksummed bundles and semantic cache descriptors remain. These run counts and
process observations were supplied by the run owner, not remeasured by this task.
The original checkout, run metadata, logs and cache were not modified.

The queue-delay accumulator belongs to `createStage1TimingBreakdownTracker`.
The processing watchdog retained a free reference after that state was extracted.
The fix reads a detached snapshot from its actual owner. All four stage watchdog
timers now route synchronous callback failures into the existing ordered-appender
abort and processing cancellation path. Normal phase-failure bookkeeping can then
persist `ERR_STAGE1_WATCHDOG` and the original diagnostic message instead of an
uncaught timer terminating the process outside the build's error handler.

A stale heartbeat plus `running` metadata is historical evidence, not proof of
liveness or valid completion. This fix does not rewrite abandoned metadata or
claim that its uncommitted files succeeded. Replay reads immutable per-file
completion descriptors independently of that metadata and absent publication;
checksums, source bytes and dependency identities still determine each admission.
The crash-specific fixture checks stale metadata remains byte-for-byte unchanged
while a valid record is admitted, and verifies future timer failures produce a
failed phase while retaining progress and reusable completion bytes.

## Safe application and resume, owned by Sol

1. Confirm the original index processes have exited and record the exact original
   invocation, environment, source root and resolved cache root. Preserve the
   failed build directory, logs, completion descriptors, bundle checksums and
   `files/semantic` cache tree. Do not clear or relabel the old run.
2. In the engine checkout, confirm a clean tree at the campaign commit above.
   Apply only the tested watchdog repair commit supplied in the handoff:
   `git cherry-pick <watchdog-fix-sha>`. Do not switch the engine to a later native
   branch or merge unrelated campaign changes. The SSR source checkout must remain
   at its recorded snapshot with identical local source/configuration inputs.
3. Use Node 26.x and run `node tools/setup/rebuild-native.js --verify` in that engine
   checkout. If readiness is incomplete, use the documented `npm run bootstrap:ci`;
   do not bypass readiness. This repair changes no dependencies or lockfile.
4. Reuse the exact original launch command and environment, with incremental
   indexing explicitly enabled (`--incremental`; the CLI default is false).
   Replace any conflicting `--no-incremental`/false setting. Keep the same absolute
   repository root, cache root, profile, semantic/parser options, modes, stage and
   dependencies. Use the patched local engine entry point, not an unrelated global
   installation. Let normal launch create a fresh build generation.
5. Look for `[incremental] restored N durable Stage1 completions before parser
   scheduling.` The reported 4912 records are candidates, not an unconditional
   acceptance count. Changed, incomplete or corrupt members must miss independently;
   valid siblings remain eligible. If N unexpectedly drops to zero, stop and compare
   the resolved cache root and source/dependency identities before doing more work.
6. Judge success from the new generation's final phase state and normal publication
   validation. The old build's `running` label/heartbeat stays historical. Never
   fabricate a current pointer, change checksums or copy an incomplete build into
   publication. A full cold reindex is not required by this repair.

The unchanged cache location is
`<repoCacheRoot>/incremental/format-<ARTIFACT_SURFACE_VERSION>/<mode>/files`.
Completion identity excludes worker/shard order and includes repository namespace,
source bytes, parse/lexical/enrichment/semantic extraction signatures and artifact
surface. The fix changes none of those owners, versions, configuration defaults,
parser packages or result-lane schema. It therefore preserves compatibility with
valid campaign completion records; it does not bypass their validation.

## Validation

Node 26.8.1 native/patch readiness verification passed. Six focused regressions
passed: watchdog recovery, durable first-stage completion, stall policy, progress
heartbeat, hot-path delegation and ordered-appender stall behavior. The documented
local pre-push gate passed: format, config budget, environment usage, generated
surface freshness, command surface, workflow contracts, all 39 gate cases and
whitespace validation. Gate cases had zero failures, timeouts or skips (41.9 s
total; slowest case 4.29 s). Workspace `.testLogs` receipts are historical local evidence and
are not promised in clean checkouts. No SSR restart, broad index or benchmark was
performed. Release acceptance and the run's underlying stall cause remain separate
from this diagnostic crash repair.
