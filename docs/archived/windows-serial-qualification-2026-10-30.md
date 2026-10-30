# Windows serial qualification — 2026-10-30

Frozen source: `51edb89916049e2d89820042231e57f51ecc36c7`, branch
`codex/pr557-audit-repairs-20261012`, Node26.13.0, Windows x64/ABI147.
The [machine receipt](windows-serial-qualification-2026-10-30.json) preserves
source identities, raw observations, original failures and report hashes.
Workspace `.testLogs` and `.tmp` paths are historical author observations,
not inputs promised in a clean checkout. This follows the
[consumer repairs](windows-consumer-repair-wave-2026-10-30.md).

## Completed observations

| Owner | Actual execution | Result and scope |
| --- | --- | --- |
| Persistent native chunk cache, #1759 |12 fresh processes; query/walk ×one/two workers ×three repetitions;32 sources ×512 declarations per isolate | PASS. Capsules9.832–13.632s. Full semantic corpus hashes agree. Original parse/JSON/clone work,32 raw clean latency samples per mode, count/byte pressure, held-cache charges and ordinary worker cleanup are retained. Two workers conserve twice the logical cache charges. Fresh-process RSS high-water is535.7–962.4MB; it includes the whole process and establishes no per-worker RSS cap or historical speedup. |
| UTF8 VFS, #1747 |Nine original cold/warm/hot steps, plus three compaction and three mixed-regeneration capsules | PASS.256 ×8,191-byte documents. Each child remains below30s; the nine-step campaign takes112.227s and is not a30-second aggregate pass. Original roots, fresh processes, independent cache phases and verified generated-work cleanup remain. |
| Map serialization, #1748 |Actual32MiB transient-allocation positive;12 counterbalanced pair capsules across two payload sizes | PASS.11,321,071 and27,186,244 serialized bytes, both atomic publication arms, exact parsed parity, raw CPU/wall/GC and scoped high-water observations. Writer capsules3.656–7.001s. This measures serialization of an already materialized map. Whole-builder acceptance remains pending below. |
| Canonical Three viewer |Fresh indexed semantic witness, real CLI/server, Chromium156/Playwright1.64.1, desktop and narrow viewport | PASS in26.170s including cleanup. Three submitted frames show actual draw calls/triangles and sampled raster variation; keyboard/member/source/relationship checks pass with no page or console errors. ANGLE SwiftShader establishes software rendering, without a hardware/FPS claim. |

Native work samples retain their original source/semantic hash pairs, operation
CPU/bytes and metrics. The machine receipt interns repeated hash pairs and omits
zero metric values with an explicit zero-default dictionary; no samples are
discarded. Serial measurements retain their individual execution bounds.

## Original failures and repairs required

- SQLite's167,936-row large seed reaches30.285s during production bundle build,
  before independent validation. Its retained WAL and checkpoint do not identify
  the unfinished native phase. A separate actual SQLite3.53.4 probe proves that
  filter-fact pagination chooses the file index and repeatedly sorts; row-ID
  keyset traversal returns identical mixed-mode rows without that sort. This
  explains redundant work, not the entire timeout. Remaining build/update
  capsules are unexecuted.
- Map preparation returns exit0 in1.971s. The parent rejects an ordinary
  pieces-manifest progress line under its strict empty-stderr guard. Three
  whole-builder observations therefore remain unexecuted. The narrow fixture
  repair selects the existing quiet log callback and retains the guard.
- Independent MiniLM q8 inference fails the original cross-batch invariant:
  two-row versus32-row raw-model results differ before any product comparison.
  Repeated32-row batches agree exactly. The exact23MB graph contains24
  `DynamicQuantizeLinear` operators; their activation scale uses the
  [whole input tensor's extrema](https://onnx.ai/onnx/operators/onnx__DynamicQuantizeLinear.html).
  Strict comparisons must use matching input batches/padding, retain the
  unchanged1e-5 tolerance, and record cross-batch export drift separately.
  Product single/batch/query/resource routes remain unqualified by this failure.
- The hierarchy browser companion assumes the complete file inventory is
  resident. The current viewer deliberately loads a bounded working set.
  Actual hierarchy search, file/member navigation, zero-member counts, aliases
  and scoring require a revised browser companion. A preceding launcher
  invocation also correctly rejects an inherited invalid trusted-config path;
  that separate environment failure is retained.

The original semantic-drain timeout and two JavaScript API setup deadlines from
the consumer receipt remain open. Their TypeScript controls pass. No retries,
larger deadlines, disabled production backends or reduced representative inputs
are acceptance evidence. Actual prepared EG2, M3/E5 numerical/quality, optional
native Tantivy, requested editor exclusions, physical-link/platform, hosted CI
and release qualification remain separate.
