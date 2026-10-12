# Semantic recovery read performance — 2026-10-11

Local branch `codex/semantic-recovery-perf-20261011`, based on watchdog repair
`d39bdf01732ccc4e2f9e5b8d9daacfcd55692999` and campaign
`d468621da9b72f5212b83689ce2ca54355a108a4`. This is a narrow performance backport;
it does not incorporate the later recovery/native branches. Those branches and
native continuation stash `bb88cde7d500a20001e2a5e85530f681a4175ec8` remain preserved.
Sol's source checkout, configuration, dependencies, running index and cache were
not changed. No full index, hosted CI, push, PR or merge was performed.

## Change and limits

Uncached offset validation previously materialized the entire offsets sidecar,
created two row-count-sized arrays, and awaited one one-byte file read per row.
It now streams offsets through 64 KiB scratch space and coalesces newline-boundary
reads spanning at most 64 KiB. Sparse boundaries still read single bytes; dense
rows trade more bytes read for far fewer I/O calls. Two buffers cap scratch space
at 128 KiB independently of row count. BigInt conversion and other transient JS
allocations still occur; this is not a process-heap or RSS cap.

Validation retains zero origin, strict monotonicity, safe integer, bounds,
sidecar alignment, exact-read and newline checks. Cache lookup precedes sidecar
loading; size/mtime/ctime invalidate both file signatures. Cancellation is checked
between bounded reads and never caches partial validation. Semantic callers keep
all source/part checksums, row contracts and canonical partition reconciliation.
No semantic producer identity, artifact format or replay identity changes.

Existing stall diagnostics already reported queues, progress, stalled files,
ordered-commit lag, subprocesses and process resources. Added bounded summaries
of the two runtime worker pools (active/queued tasks, configured/effective workers,
restart attempts, pending restart, disabled, heap limit and pressure state), plus
scheduler token totals/usage and pending/in-flight byte capacity. Missing or failing
pool stats are marked unavailable with a capped error. These are existing counters,
not active liveness probes. No original stall-cause investigation was performed;
its underlying cause remains unknown.

## Measurements

Windows, Node v26.8.1, isolated prepared worktree, OS-cache-warm temporary copies,
five samples per variant. Original validator came from the exact base SHA above;
updated validator is the source committed with this receipt. Dataset preparation,
copying and explicit GC were outside timed intervals. Concurrent host activity
(including Sol's index) was preserved, so these are local observations, not release
acceptance or end-to-end indexing throughput claims.

| Workload | Original median | Updated median | Change |
| --- | ---: | ---: | ---: |
| Uncached offsets, 20,000 rows | 658.736 ms | 5.496 ms | 99.2% less time |
| Cached offsets, same rows | 1.524 ms | 0.127 ms | 91.7% less time |
| Full durable completion validation, 4,000 nodes | 229.187 ms | 93.848 ms | 59.1% less time |

Offset uncached samples (ms): original `[625.045,580.940,658.736,782.242,898.461]`;
updated `[10.350,6.109,5.496,5.403,5.377]`. Data/offset handle reads dropped from
20,000 to 13 per sample. Combined uncached/cached offset `readFile` bytes fell
from 320,000 to zero. Total bytes read increased from 340,000 to 747,278 due to
coalescing; cold-storage behavior is unmeasured. Largest updated read buffer was
65,536 bytes. Five-ms sampled heap deltas ranged 6.97–7.24 MB original and
3.41–5.10 MB updated; sampled RSS deltas were 0.41–2.06 MB and 0–0.81 MB.
Sampling misses transient peaks and allocator reuse affects deltas; rely on the
structural scratch bound, not these observations as a heap guarantee.

Completion samples (ms): original `[229.187,224.741,379.580,334.677,225.813]`;
updated `[90.778,86.952,238.600,203.704,93.848]`. Every timed call accepted the full
completion after source/bundle/member/partition validation. An initial 5,000-node
fixture was rejected before measurement by the 4,096-row producer batch contract.
It was corrected to 4,000 nodes; no limits or deadlines were increased.

Reproduce the offsets measurement on prepared Node 26.x using the existing entry:

```text
node --expose-gc tools/bench/index/jsonl-offset-index.js --mode validate --rows 20000 --iterations 5
```

For the original comparison use the same benchmark harness with `offsets.js` from
the base SHA in an isolated checkout, never an active index checkout. The replay
measurement used this script via `node --expose-gc --input-type=module` at repo root
(after documented readiness), once per validator version:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createSemanticCacheFixture } from './tests/helpers/semantic-cache-fixture.js';
import { readFileCompletion } from './src/index/build/incremental/file-completion.js';
const fixture = await createSemanticCacheFixture();
try {
  const file = await fixture.createFile({ nodeCount: 4000 });
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const bundleDir = path.join(fixture.root, 'replay-' + i);
    await fs.cp(fixture.bundleDir, bundleDir, { recursive: true });
    global.gc();
    const start = performance.now();
    const result = await readFileCompletion({ bundleDir, relKey: file.file,
      sourceBytes: file.bytes, semanticContext: { repoRoot: fixture.repoRoot,
        repositoryNamespace: fixture.repoRoot, dependencySignatures: fixture.dependencies } });
    samples.push(performance.now() - start);
    assert.ok(result);
  }
  console.log(samples);
} finally { await fixture.cleanup(); }
```

## Validation

Native/patch readiness verification passed under Node 26.8.1. Focused regressions
cover dense windows, cross-window corruption, restored-mtime cache invalidation,
sparse reads, misaligned/short sidecars, cancellation/handle cleanup, existing
random access, and real watchdog scope plus bounded diagnostic faults. All nine focused cases passed (123 ms–2.47 s): watchdog recovery, offset
misalignment/unified/windowed validation, semantic cache transactions, cross-part
reconciliation, hydration, first-stage completion and tamper recovery. The complete
documented local pre-push gate passed: format, config budget, environment usage,
generated surface freshness, command surface, workflow contracts, all 39 gate
cases and diff whitespace. The gate lane took 9.77 s; slowest case 4.90 s, with
zero failures, timeouts or skips. Roadmap size is 19,980 bytes. Local `.testLogs` and `.benchCache` receipts are historical
author-workspace evidence, not files promised in clean checkouts.

Remaining: full SSR throughput/RSS impact and cold-I/O behavior are unmeasured.
No claims of multi-worker or release acceptance follow from these fixtures.
Native continuation and later recovery work remain on their own preserved lines.
