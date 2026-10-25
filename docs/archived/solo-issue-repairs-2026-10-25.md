# Solo issue repairs — 2026-10-25

## Scope and execution policy

Continue on `codex/pr557-audit-repairs-20261012` and PR #572, using Node
26.12.1 on Windows. The user resumed implementation first on October 25:
batch related open issues, defer test execution until implementation is ready,
and commit/push completed source batches. No workers, worktrees, Linux/WSL,
elevation, security-setting changes, physical-link creation or merge is included.
Formatting and static/generated checks continue. Authored regressions below are
unvalidated unless a later source-bound receipt explicitly records execution.

The live GitHub intake contains **763 open issues**: P1 31, P2 336, P3 46,
Perf 115 and other/unprioritized 235. There are no P0/P4 reports in this snapshot.
Titles determine priority. This is an open-issue inventory, not a claim that
every open report has been independently reviewed or fixed. Existing PR coverage
and historical receipts remain separate from GitHub open/closed state.

## Completed implementation batches

- **#1746: VFS I/O benchmark deletion ownership.** `--outDir` selects a parent;
  the benchmark exclusively creates a unique child, uses exclusive file writes,
  joins every started writer before cleanup and starts no subsequent batch after
  failure. It rechecks admitted parent/root identities and removes only that
  child. Invalid modes fail before filesystem work. Cleanup failures preserve
  the original work error as cause and retain the refused run directory.
  `tests/perf/bench/vfs-io-ownership.test.js` covers the actual CLI, unrelated
  parent bytes, retained outputs, concurrent runs, held/failing writers and
  cleanup refusal. Execution is deferred.
- **Validation fixture repairs carried forward.** The completed-stage schema
  negative now constructs an explicitly unobserved producer, rather than
  deleting an optional reason from the observed checkout identity. Native job
  selection uses the current producer's exact disabled/expired-selection
  diagnostics. Native search fixture publication now receives the same explicit
  cache root as its isolated CLI child; parent environment configuration cannot
  silently redirect the fixture's artifacts. Assertions remain intact; rechecks
  are deferred.

## Authored priority batch

The following priority implementations are also authored with execution deferred:

- **#1742:** ANN health/preflight success preserves unknown latency. Only finite
  nonnegative numeric observations update the EWMA, whose first sample initializes
  directly. Healthy measured providers precede unknown providers in stable base
  order; cooldown/failure penalties remain independent.
- **#1730:** adaptive I/O growth uses actual configured/sampled FD caps. Unknown
  evidence remains null with explicit provenance, rather than copying current
  capacity into an invented ceiling. Cap contraction preserves admitted use.
- **#1736:** Python import continuation balances signed delimiter changes across
  logical lines and preserves blank/comment continuation lines. Both collector
  APIs and registry projection retain later independent imports. Import-resolution
  producer version advances **16 → 17** to invalidate incomplete cached extraction.
- **#1741:** shard-gap checks and binary sidecar/checksum selection use canonical
  artifact names separately from physical backup paths. Primary and backup reads
  retain the same missing-shard and checksum obligations.
- **#1740:** streamed binary rows enforce their byte allowance before allocation
  independently of aggregate data-file admission. Many small rows may still stream
  across a larger file; an oversized row reports a typed capacity error.
- **#1737:** zstd JSONL always uses the existing owned streaming decoder. The
  optional whole-buffer decoder had no decoded-output allocation bound. Its now
  unreferenced private reader resolver/threshold were removed after a repository
  reference search; writer/native dependency support is unchanged.
- **#1734:** watch startup and steady state share one closeout region, including
  discovery/backend/callback failures and startup cancellation. The original close
  receiver/method is captured once; each cleanup step proceeds despite sibling
  failure. Failed/unknown closure retains pending ownership. Exact listeners are
  removed, active work drained and terminal observations attempted on every exit.
- **#1729:** dense validity compares captured semantic fields without serializing
  the complete bitmap per lookup. SQLite ingestion admits a private mask snapshot
  once for array, buffer and async-row paths; later invocations re-admit changed
  metadata and retain invalid-count/mask rejection.
- **#1716:** symbolic graph admission captures bounded passive JSON before signal
  or hydration callbacks. Only privately owned frozen entries carry cached
  validation; the writer uses their admitted byte/hash measurement. Regressions
  exercise raw mutation, accessors/proxies, byte/node bounds, cache reuse and a
  real writer-to-reader roundtrip.
- **#1698:** decision, context-pack and history selection share one contained,
  bounded snapshot reader and reject requested/embedded identity conflicts.
  Decisions retain a compact receipt for exact admitted bytes and source/ID
  provenance. A later same-ID finding update cannot retarget an earlier receipt.
  Source extension fields remain supported; no outer record version is invented.
- **#1565:** replay, completion preload and missing-bundle recovery use the
  existing descriptor-verified source owner. Import scans pass their actual root
  and cancellation signal. Shared read entries carry private map/root/file
  receipts, fresh descriptor checks and a 16 MiB/256-entry retention bound;
  callers cannot forge admission or mutate retained bytes. SHA-1, semantic
  SHA-256 and text derive from the same snapshot. The existing one-payload-read
  bundle/import assertion remains, now observing actual descriptor reads and
  real fixture timestamps. Prefix preprocessing also passes containment authority.
  Original pending read/close errors cannot become ordinary cache misses.

New/extended regressions cover the numeric, continuation, capacity, backup,
startup and per-ingestion invariants. They have not been executed in this wave;
no latency/memory speedup or acceptance count is inferred from these source changes.

Static formatting, config budget/environment checks, generated freshness and
command-surface checks passed for the earlier cleanup/fixture batch. Roadmap
history moved to a linked archive to restore its 20 KB budget. The missing inherited
trusted-config selection was omitted only from check children; no trust was granted.

## Remaining work

Implement remaining priority defects before perf/unprioritized work, retaining
the existing issue mappings and authored coverage. Finish the interrupted
Windows validation selection and resolve its outstanding export deadlines and
native lifecycle cases when execution resumes. Preserve the original failure
receipts and distinguish mixed-source passing observations from acceptance of
the final candidate. Update PR #572 with source batches and exact validation
status; no all-issues or whole-suite closure is claimed here.
