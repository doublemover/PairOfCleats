# WASM semantic implementation checkpoint — 2026-10-10

This receipt covers implementation commit
`0872c85a1cd30568ead8e69a455de593148113e9` on
`codex/wasm-semantic-analysis-20261010`, based on campaign
`d468621da9b72f5212b83689ce2ca54355a108a4`. It extends the initial WASM commits
`ed54212d` and `48bab65e`. [PR550](https://github.com/doublemover/PairOfCleats/pull/550)
targets `codex/semantic-resume-campaign-20261010`; this receipt does not authorize merging.
The [active roadmap](../roadmap.md) owns remaining priorities and the
[semantic guide](../guides/semantic-index.md#wasm-module-evidence) owns usage details.

## Implemented surface

- Standalone `.wasm` admission through normal file processing, binary source
  manifests and retained byte blobs; module anchors and derived analysis use the
  shared syntax/analysis partition split. Text hydration and LSP skip binaries.
- Checker-authorized immutable byte aliases, literals/spreads, typed-array copies
  and views, Response/arrayBuffer chains, streaming APIs, and anchored URL fetch/fs
  candidates backed by the retained source inventory. Arbitrary URLs are not read.
- Bounded core and proposal decoding: recursive GC types, references, multi-value,
  bulk memory, passive/declarative segments, SIMD/relaxed SIMD, atomics/shared memory,
  memory64/multi-memory, tail calls, tags and modern/legacy exception syntax.
- Stack/local merges, branch/loop/reference flow, exception payloads and ordered
  handler candidates, legacy catch/delegate/rethrow, and separate uncatchable traps.
- Exact fixed internal indirect-table slots, bounded conservative may-target sets,
  direct/reference/tail calls and storage read/write/copy/mutation dependencies.
- Host import/export joins, shared compiler return/exception summaries with finally
  overrides, positional multi-value channels and host memory/table/global aliases.
  Tag aliases require declaration authority; runtime imported tag identity is unknown.

The implementation reuses the evidence registry, partition schemas/writers,
publication contracts, producer invalidation and cache fence. It does not add a
recovery journal, storage-accounting owner or alternate scheduler. WABT opcode
metadata is pinned and carries its attribution and Apache license in the source tree.

## Validation and setup

The selected checkout used the published cloud setup workflow. The inherited
activation selected Node 24; official checksum-verified Node 26.8.1 and writable
caches were installed for this task. `npm run bootstrap:ci` passed, including native
builds, required patches and readiness. A later `rebuild-native.js --verify` also
passed. An inherited trusted-config override pointed at a missing `/opt` file;
clearing that stale override restored the default authority checks. No readiness
receipt, native backend or approval gate was bypassed.

The ready-to-publish source batch passed `npm run format`, `config:budget`,
`env:check`, generated-surface freshness, command-surface audit, workflow contracts,
all **39 gate tests**, and `git diff --check`. The gate's slowest test took 5.50 s.

The final affected batch had **12 passes and one failure**, with no retries, skips
or timeouts. All six WASM fixtures passed: module analysis, compiler host links,
source admission, proposal/storage effects, exception/reference flow, and host
completions. Related boundary, semantic foundation/handoff, producer-identity,
partition and detail-hydration checks also passed. WASM source admission covers the
full per-file processor, original-byte tamper rejection, retained-vs-working-tree
bytes, streaming/Response/fs provenance, disabled/deferred policy and existing
cache invalidation. Proposal fixtures also reconcile published partition references.
The slowest affected test took 3.38 s.

The unchanged `tests/indexing/semantic/cache-reader-identity.test.js:39` fails
because it expects a `fieldPathDepth` change to alter the syntax dependency
signature. A focused diagnostic executed the dependency function from published
`48bab65e` and the current function: both preserve the syntax signature and change
the analysis signature. The existing `analysis-version-identity` contract test
passes and explicitly requires that split. This is an inherited fixture/contract
conflict for the separate recovery owner; this branch does not change that test or
Stage1 replay/storage accounting. It is not counted as passing acceptance.

Author-workspace logs under `/workspace/.wasm-setup/` and `.testLogs/` are historical
local receipts, not shipped files or promises about a clean checkout. No full index,
benchmark, release-wide validation or repeated gate campaign was run. Hosted CI
must be evaluated against the exact pushed head separately.

## Explicit remaining limits

Static evidence does not determine actual network responses, filesystem state,
activation, conversions, arbitrary iterable results, mutable/escaped bytes,
cross-source instance aliases, imported tag identity, storage contents/order, GC
aliases/lifetimes, atomic ordering/wakeups, relaxed SIMD choices or memory growth
and view epochs. Calls retain context-insensitive channels. Component/experimental
formats, unknown instructions and engine-unavailable proposals are not silently
accepted; validation and budgets produce explicit reasons.

Standalone binary deferred enrichment is not scheduled, and binary flow does not
support the text/declaration target selector. These configurations report unsupported
coverage; eager or eligible-auto local flow provides the bounded analysis. Broader
language adapters and recovery qualification remain in the campaign roadmap.
