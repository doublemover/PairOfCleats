# Semantic capability follow-on — 2026-10-11

This is an isolated implementation checkpoint on
`codex/semantic-capabilities-20261011`, based on
`55a8a97886b0918189b9b61209ff148b5459b5a2`. The approved parent checkpoint was pushed
unchanged as `codex/js-semantic-frontiers-20261010` and published as draft
[PR552](https://github.com/doublemover/PairOfCleats/pull/552), targeting
`codex/wasm-semantic-analysis-20261010` at
`19b1f6b88602c2ddaf91f3eb7bd8499425aaa859`. Readback verified both SHAs and draft
status. The capability follow-on is not included in that publication and has no
publication approval. No branch was merged or retargeted.

## Implemented

- Deferred standalone WASM local flow uses the existing durable task, lease,
  scheduler, source-verification, receipt and generation-publication owners.
  Binary dependency authority pins one module, producer and validator runtime.
  The binary capability obtains scheduler capacity without a TypeScript Program
  grant or compiler measurement receipt. Structural replay remains separate from
  granted flow. Module selection uses the existing source-pinned anchor contract.
- Production binary discovery now survives the shared preprocessing binary filter
  when semantic WASM code indexing is enabled. The earlier per-file admission
  alone did not reach production decoding. Other binary filtering is unchanged.
- Constructor receiver effects, parameter properties, visible instance initializers,
  default derived forwarding and explicit super candidates use shared summaries.
  Getter/setter invocations retain return, parameter and receiver-effect channels;
  getter-returned source callables participate in dispatch. Private paths include
  source/class identity and do not overlap public wildcard paths.
- Source-backed imported Node port aliases and literal transfer provenance connect
  workerData/message-carried endpoints to original MessageChannel candidates.
  Omitted transfer lists and dynamic keys establish no endpoint identity. Bounded
  fixed-point propagation reuses the existing worker boundary/evidence writer.
- Atomic provider selection validates all source/context/immutable partition joins
  before selecting facts. Identical output duplicates select once. LSP invocation
  refs distinguish called member names from receiver/key occurrences. Validated
  provider targets supplement the existing argument/return/effect summaries, with
  unknown remainders. Retained summaries contain no compiler Program references.
- Evidence-only trace hydration has a separate visited identity from traversal.
  A reference first hydrated as evidence can subsequently expand semantic edges,
  including across continuation pages.

Affected shared producer versions advance; no schema, public configuration knob,
second task scheduler or recovery/accounting subsystem was introduced.

## Validation and provenance

The published cloud bootstrap completed under checksum-verified Node 26.8.1.
This continuation refreshed readiness with
`node tools/setup/rebuild-native.js --verify`; natives and required patches passed.
All tests use the normal readiness gate, at most 30 seconds per case, no retries.

Final source acceptance is recorded below. Author logs under `/workspace/.wasm-setup/` and `.testLogs/`
are historical workspace receipts, not files promised in a clean checkout.
No repository-scale index, benchmark or repeated broad validation campaign ran.

Production fixtures found and drove fixes for the preprocessing admission gap and
binary source namespace mismatch. Provider/trace fixtures were repaired to use
canonical partition identities and query indexes. The inherited LSP fixture's
obsolete config key and Windows-only Node path were updated to current contracts.
The compiler production check now asserts channels for the two actual imported
call sites, rather than assuming the first two globally ordered return edges have
different call sites; multi-target dispatch legitimately supplies several edges.
Initial failures are not passing acceptance evidence.

## Remaining limits and ownership

- Binary limits remain 64 KiB per module and bounded decoder/flow work. Runtime
  validation depends on the recorded V8 proposal support. Scheduler reservation is
  an estimate, not a hard heap cap. Text/declaration selection remains unsupported.
  Runtime memory ordering, activation, dynamic tables, external byte mutation and
  unsupported proposal semantics retain explicit uncertainty.
- Object paths and calls remain may-flow: runtime private-brand checks, constructor
  object-return overrides, initialization order, decorators/proxies, escaping
  aliases, lexical arrow receivers, strong updates, async/generator protocols and
  complex completion alternatives are not closed-world execution proofs.
- Node transfer provenance is limited to bounded literal/const payload structures,
  literal transfer lists and retained source endpoints. Browser transferred ports,
  Node EventTarget listeners, BroadcastChannel, arbitrary RPC protocols, instance
  multiplicity and actual detachment/delivery remain open.
- Provider joins require known source function summaries in the same compiler
  group/generation; external implementations remain unknown. Limits are 4096 scanned
  provider edges and 32 targets per invocation.
- The separate recovery owner retains interrupted Stage1 resumption, transient
  accounting and the inherited cache-reader identity assertion conflict. That
  unchanged assertion expects analysis-only fieldPathDepth to alter syntax cache
  identity. It is not counted as passing; the shared analysis-identity regression
  remains the applicable contract here.
- Python/C/Swift/Rust adapters, estimator calibration, broader platform/release
  acceptance and exact-head hosted CI remain separate work.

## Final checkpoint validation

Implementation commits:

- `c195c522`: evidence hydration/traversal identity regression and fix.
- `d6ce5c2e`: binary capability, deferred publication and preprocessing admission.
- `0cfd34140d8ff78254bae8b8b7b943bed92f963a`: object/port/provider precision.

Twenty distinct affected fixtures pass on the final implementation. The 20-case
batch passed 19 cases; the order-dependent compiler-bindings assertion described
above was corrected, and that fixture then passed its cold/warm production paths
in 22.6 seconds. No source behavior changed after the batch. Other cases include
shared JS deferred drain (14.1 seconds), binary drain, module admission, host flow
and completions, compiler CFG/dispatch/invocation/class initialization, call summaries,
object effects, browser/Node worker joins, transferred ports, provider joins,
LSP location evidence, trace parity/continuation and shared analysis identity.
There were no timeouts, skips or retries. The failed initial assertion is retained
as diagnostic history, not counted as a green run.

The documented local front gate passed once for this batch: ESLint formatting,
config budget, environment usage, generated-surface freshness, command-surface
contracts, workflow contracts, all 39 gate cases and `git diff --check`. The gate
lane took 15.5 seconds; its slowest case took 4.83 seconds. Only this prose receipt
changed after those checks. Broad platform/performance acceptance and hosted CI
for the unpublished follow-on remain unrun.

The proposed follow-on destination is `codex/js-semantic-frontiers-20261010`;
publishing or opening a follow-on PR requires a separate approval.
