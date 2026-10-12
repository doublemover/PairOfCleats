# JS/TS semantic frontiers checkpoint — 2026-10-10

Implementation commit: `2ca5a4174110409325f837f0714a564c03d888b9` on
`codex/js-semantic-frontiers-20261010`, created from completed
WASM head `19b1f6b88602c2ddaf91f3eb7bd8499425aaa859`. This follow-up remains separate
from [PR550](https://github.com/doublemover/PairOfCleats/pull/550). Publication and its
proposed destination `codex/wasm-semantic-analysis-20261010` require approval; no
merge is authorized. Remote readback confirmed PR550 is open on the original campaign
base and still points at the WASM head above; this new branch has not been pushed. The
[roadmap](../roadmap.md) owns priorities and the [guide](../guides/semantic-index.md)
owns supported behavior.

## Implemented

- Conditional/mutable aliases retain bounded may-locations, unknown binding roots
  and assignment/escape uncertainty. Computed literal-key unions and unknown keys
  overlap concrete paths; weak writes retain earlier values. Literal `"*"` is distinct
  from a widened key. Shared property helpers serve heap and dispatch analysis.
- Call-site summaries retain known callable alternatives alongside unknown result,
  heap and exception candidates. Positional/rest channels and nested summary inputs
  preserve alternatives. Bare/implicit returns carry undefined completions; explicit
  finally overrides retain existing completion filtering. Receiver field effects can
  reach following caller reads without asserting unique storage or dispatch.
- Source-backed object/class callable members, inheritance, visible allocations,
  prototype replacement and callable reassignment augment checker candidates.
  Accessor declarations are excluded as targets of the callable they might return.
  Anonymous callable anchors use existing syntax rows. Missing export declaration
  hops retain the last mapped import binding, fixing the production re-export chain.
- Verified Node worker_threads declarations join retained anchored worker entries,
  workerData uses, direct message payload callbacks, parentPort replies, and opposite
  ports of visible MessageChannel allocations, including const/destructured aliases.
  The implementation reuses compiler authority, boundary ledgers and artifact writers;
  bounded joins record unresolved peers, dynamic/eval options and delivery uncertainty.
- Standalone binary eager/eligible-auto flow accepts a source-hash-pinned syntax
  module ref (local ID 0), explicitly widening to the whole module. Binary target
  validation reads the anchor data and rejects text ranges against the zero-length
  text snapshot. Existing parser, partition and replay contracts remain authoritative.

The shared producer versions advance for bindings, CFG/call flow, worker/boundary
models and WASM analysis. StorageFlow and Stage1 recovery/accounting owners are
unchanged. No scheduler, journal, cache authority, public knob or schema enum was added.

## Validation

The existing published cloud setup uses checksum-verified Node 26.8.1 and writable
caches. `npm run bootstrap:ci` passed for the base task; this pass refreshed readiness
with `node tools/setup/rebuild-native.js --verify`. No readiness or authority bypass
was used. Missing optional previous-build compiler telemetry is expected on a cold
fixture and is not a setup failure.

Thirteen distinct affected fixtures pass: compiler bindings (cold/warm production),
CFG flow, dispatch alternatives, call summary context, Node worker joins, browser
worker joins, compiler invocation, class initialization, control regions, shared
analysis identity, WASM source admission, WASM host flow and WASM host completions.
The final related ten-case batch passed with no retries, skips or timeouts; its
slowest fixture took 17.5 seconds. New tests reconcile partition references and
exercise negative cases: accessor targets, fake platform classes, isolated ports,
eval entries, unknown targets and text-range selection of binary sources.

The production fixture initially exposed the existing missing import/re-export
alias chain. A direct retained-source/checker diagnostic identified the export
occurrence without a declaration anchor; the linker correction passed the fixture.
The targeted WASM test initially caught a missing detail-field projection and passed
after the validator requested anchor data. These initial failures are not passing
receipts; the corrected affected checks are the acceptance evidence.

The local front gate passed formatting, config budget, environment usage, generated
surface freshness, command-surface audit, workflow contracts, all 39 gate cases and
`git diff --check`. The gate's slowest case took 5.11 seconds. Subsequent final review
corrected SCC uncertainty propagation without new value inputs; a dedicated cyclic
regression and the affected dispatch/summary fixtures passed after that correction.
Only affected tests were rerun; the full gate was not repeated. Formatting and final
diff checks were refreshed before committing.

The inherited `tests/indexing/semantic/cache-reader-identity.test.js:39` conflict
remains with the recovery owner. It expects fieldPathDepth to change the syntax
cache signature, contrary to the separate analysis identity contract. The prior
WASM receipt documents the same behavior at published `48bab65e` and its final
source. This pass does not alter or rerun that unchanged conflicting fixture;
`analysis-version-identity` passes. The conflict is not counted as passing acceptance.

Logs in `/workspace/.wasm-setup/` and `.testLogs/` are historical author-workspace
receipts, not deliverables promised in a fresh checkout. No repository-scale index,
benchmark, release qualification or repeated broad validation campaign was run.
Hosted CI remains separate exact-head evidence after approved publication.

## Remaining

- Precise constructor initialization, private brands, getters/setters returning
  callables, proxies, escaped aliases, lexical arrow receivers, callable bind/apply
  behavior and strong property updates. Current dispatch and heap links are modeled.
- Async/generator completion protocols, arbitrary iterable/default argument values,
  rest-array mutation mapping, deeper path/context precision and complex completion
  alternatives. Truncated candidates/work retain partial coverage.
- Transferred/cross-file port identities, worker instance multiplicity, EventTarget
  Node listeners, BroadcastChannel and provider-specific RPC/retrieval joins.
  Static clone/transfer/delivery requests do not prove runtime delivery or activation.
- Deferred standalone binary tasks. Current deferred execution authorizes sealed
  TypeScript Programs; binary work needs a supported shared-task capability, not a
  fabricated compiler grant or a second scheduler. Text/declaration targets remain
  unsupported; module selection requires eager local flow in the targeted profile.
- The WASM receipt's remaining runtime/storage/proposal limits, other language
  adapters and the separately owned recovery qualification remain open.
