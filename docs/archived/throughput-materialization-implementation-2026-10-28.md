# Throughput materialization and compilation-status reconciliation — 2026-10-28

Source implementation/review, **UNVALIDATED**. Windows x64, Node 26.12.1,
branch `codex/pr557-audit-repairs-20261012`. No functional fixture, child,
benchmark, native provider or editor host ran for this checkpoint.

## #275: semantic refresh and persisted provenance

Source `c08076a81c07b9e2c3f1be12f3fc311a14e9c44f`, tree
`ec86d257e999a0e4b392fc468f895c72f62bfd1c`:

- Actual analysis reconstruction owns `generatedAt` as the invocation time.
  Explicit materialization still reconstructs first, then compares every other
  semantic field. Equal content retains the original object/time/key order and
  produces no dirty write; changed source content remains a real refresh.
- Default reads and unavailable-refresh fallback preserve the stored
  materialization source/category/derivation instead of relabeling that analysis
  native. Existing indexing/ledger provenance owners remain in use.
- Missing/malformed source during an explicit refresh of prior derived analysis
  preserves that evidence and produces a typed unavailable-refresh outcome. The
  materializer reports the failed section and exits nonzero; it cannot present
  that failed refresh as a successful unchanged reconstruction. Independent
  valid sections may still be materialized and are counted normally.

Nine new `tooling/reports/throughput-analysis-materialization/*` cases are
authored, **unexecuted**: equal content, key order, changed source, missing and
malformed source, derived/native read provenance, actual CLI idempotence with
byte/inode/mtime assertions, and actual CLI refresh failure. They use small
actual build-state files and an explicit old timestamp so the original clock
defect cannot pass accidentally within one timer tick. Existing multi-metric,
history-isolation, deep-analysis, read-only and recorded-attempt controls remain.

ESLint format, three changed JavaScript syntax checks, whitespace and static
module-cycle analysis (zero cycles) passed. These are not functional or measured
performance evidence. Historical structural analysis still reads live build
state and is **not** qualified as an immutable attempt snapshot; #1680 retains
that separate scope. No historical measurement timestamp was normalized.

## #289: previously implemented source, pending native qualification

The older unresolved classification was stale. The actual compilation owner,
provider preflight/run integration and existing [compilation receipt](clangd-compilation-context-implementation-2026-10-27.md)
already record source `342c39c7b05ce17e8750c93b3a47b9b23e631703`, tree
`efe1926c071bbf5fb22070ff5541563b86f4d181`: bounded database/response-file
admission, explicit-selection failures, exact/ambiguous/weak per-document
coverage, launch/document/source revalidation, shared preflight/run receipts,
weak-only planning and hover limits, physical exact URIs and separate diagnostics.
No compiler command is executed by admission. No duplicate implementation was
added during this reconciliation.

The 25 original admission cases, actual LSP fixture collector, existing
positive/negative controls, real Windows clangd timeout-storm reproductions and
full original/follow-up acceptance remain unexecuted for this source wave.
#1161 toolchain closure and #1146 installed invocation-profile qualification
remain their separate owners. Current shared producer versions are retained;
this review does not restore the earlier receipt's historical version number.

Both issues stay open, now source-implemented/qualification-pending. The owner
queue becomes **480 pending, 144 partial, 94 unresolved** of the last 718-open
inventory. Source commits remain unpublished while functional checks and the
publication gate are deferred.
