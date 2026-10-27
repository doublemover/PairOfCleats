# Uncached SQLite ownership and obsolete probe — 2026-10-27

Source `55d0daa9f9d078e81205dcc8ef5cac5aaa404643`, tree
`d63a8654df08c85b923069cac14d0f5bbfe4efed`, on
`codex/pr557-audit-repairs-20261012`; Windows x64, Node 26.12.1.
[Machine-readable receipt](sqlite-uncached-close-ownership-2026-10-27.json).

Uncached backend disposal previously set its disposed flag before invoking
native closes. After one close failed, the next disposal returned success. A
`false` native result was also accepted, and initialization/cleanup aggregation
could drop the original resource-settlement observation.

Uncached handles now reuse the existing physical SQLite close owner, captured
before initialization probes. Disposal retains its exact failed outcome,
attempts independent sibling cleanup, and composes original observations through
the shared storage-error owner. Ordinary disposal does not repeat a failed native
close. Explicit reconciliation remains with that original owner; changing a
reported callback cannot settle its captured native observation. Cached handoff
and lease ownership remain with the existing cache.

Four real native regressions fail before and pass after: sticky failure, a
pending original native observation, explicit false closure and initialization
failure with failed cleanup. Valid databases contain an asserted chunk; the
initialization negative preserves format rejection. The existing generation
fixture retains all-handle cleanup and one ordinary close attempt, moves failure
injection before method capture, and now requires the original failed outcome
plus explicit settlement. No assertion or test was deleted.

The unused `getSqliteChunkCount` function, its private map and sole cache-key
import were removed after an all-tracked-file search at `53f0e70d0`: every symbol
reference was inside that function/file; no caller, test, documented entry point
or package entry referenced it. The private package exposes CLI bins. Current
auto-selection uses `resolveIndexStats` in `src/retrieval/cli/auto-sqlite.js`,
reading manifest/artifact statistics. Its compressed-JSONL statistics fixture and
the live reader's schema/format negatives still pass. This removal does not
change backend selection or remove meaningful coverage.

**12 affected fixtures and 40 gate cases pass**, with the remaining cheap front
gate checks. The final diff check initially caught an extra blank line left by
removal; only that whitespace changed, and the diff check passed afterward.
The original failure and successful repair check are retained separately. All
fixture deadlines are 30 seconds, retries are zero and native-status redo is
disabled. No editor UI, symlink creation, dependency change or privileged launch
was used.

**#1574 remains open.** This extends the
[existing cleanup admission repair](repository-cleanup-admission-2026-10-27.md).
Producer/publication registration for custom backend roots, remaining resource
session/adapter lifetimes, category qualification and multi-repository cleanup
remain. Cleanup continues protecting custom external backend roots.

Historical author-workspace evidence lives under
`.tmp/tasks/sqlite-uncached-ownership-20261027/` and referenced `.testLogs/`
directories; it is absent from clean checkouts. The committed receipt retains
case identities, commands and the obsolete-code search witnesses.
