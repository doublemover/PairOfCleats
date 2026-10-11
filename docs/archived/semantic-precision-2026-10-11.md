# JS/TS/WASM precision follow-on — 2026-10-11

This isolated implementation continues `59841189bf157f1718ad29a3178dbe2598e84030`
on `codex/semantic-precision-20261011`. The approved parent checkpoint is published
unchanged as draft [PR554](https://github.com/doublemover/PairOfCleats/pull/554),
head `codex/semantic-capabilities-20261011`, base
`codex/js-semantic-frontiers-20261010` at
`55a8a97886b0918189b9b61209ff148b5459b5a2`. Remote SHA and draft/open/unmerged PR
metadata were read back. This precision follow-on remains unpublished; no merge
or retarget was performed.

## Ownership and implemented scope

Four requested helpers were actually launched with model `gpt-6-astra`, reasoning
`medium`, and disjoint ownership:

- `object_alias_precision`: destructured receiver aliases, nested literal field
  lookup and callable receiver alternatives.
- `browser_port_precision`: browser worker/MessagePort transfer provenance and its
  bounded propagation helper.
- `provider_rpc_precision`: provider declaration alias joins and negative evidence
  tests; no unsupported RPC protocol was inferred.
- `adversarial_wasm_trace`: WASM byte/instance/promise escape regressions and malformed
  binary authority. No additional trace defect warranted a speculative change.

The root integrated shared runtime parameter and call-adapter handling, producer
identities, production tests, documentation, publication of the approved parent,
and the final gate. Native-language adapters, Stage1/cache recovery and transient
storage accounting remained outside the team.

Object field paths now preserve bounded nested object/array/default destructuring,
mutable receiver alternatives and aliased class heritage. Nested shorthand/spread
initializer lookup follows the selected field path; the former spread path could
return the whole spread object and miss the actual initializer's dependency.
Actual CFG reachability is asserted. Rest-copy identity, alias snapshots, property
overwrite order, proxies and escaped mutation remain conservative.

Checker-authorized Function.call/apply and source-backed const bind chains reuse
shared call summaries. Native receiver/argument adaptation retains literal apply
positions, bound prefixes and the first receiver on rebinding. Unknown method
replacement retains original operands separately from positional mappings. This
fixes a reviewed case where an ignored `.call` receiver disappeared from unknown
result/effect dependencies. TypeScript's type-only `this` parameter consumes no
runtime ordinal in either JS summaries or WASM host callbacks, including rest
callbacks. Dynamic apply inputs, bound construction and cross-source bound captures
remain unresolved; adapter chains/arguments and unknown-only inputs are bounded.

Browser transfer propagation covers worker requests/replies, port relays,
MessageEvent.ports and nested literal payload object/array paths. Port-relative
indices follow the [HTML transfer rules](https://html.spec.whatwg.org/multipage/web-messaging.html#message-ports).
Source provenance or default-library authority is required; speculative any-typed
listener names do not become global-worker consumers. Missing/dynamic/duplicate or
oversized transfers and uncertain index shifts retain unknowns. Bounds are eight
rounds, 32 candidates/list entries, eight payload-path levels and 100,000 join work
units, including registration scans and payload expansion. Delivery, detachment,
start/close order and runtime instance correlation are not established.

Provider call/construct targets can follow directional, context-qualified,
evidence-backed exact declaration aliases to retained source summaries. Value/heap
aliases and name matching are not declaration authority. The implementation also
prevents construct targets from joining ordinary call sites. Limits remain explicit:
4096 scanned edges, eight alias levels, 256 queued aliases, 32768 traversal steps
and 32 targets per call. External bodies without retained summaries and arbitrary
RPC delivery/response protocols remain unknown.

WASM host joins distinguish shared ArrayBuffer views from independent typed-array
copies. Mutating or escaping a shared view now blocks native-byte provenance.
Escaped/shadowed Instance aliases, instantiation result wrappers and promises with
unobserved consumers no longer establish exact native export joins. Safe const
aliases and awaited promise/instance wrappers retain supported joins. These defects
were reproduced with failing fixtures before correction. Malformed binary task
containers/source rows now reject with the binary-authority error rather than an
incidental TypeError. Decoder/proposal scope was not broadened.

Affected shared versions advance for compiler bindings, CFG/call summaries, worker
flow, boundary flow and WASM flow. No new public configuration or schema was added;
existing provider, task, evidence and publication contracts remain authoritative.

## Validation provenance

The published cloud setup uses checksum-verified Node 26.8.1. The continuation
refreshed readiness with `node tools/setup/rebuild-native.js --verify`; required
natives/patches and readiness passed. No setup bypass or fabricated receipt was used.

Helpers ran focused regressions with the repository runner, 30-second per-case
limits, one job and no retries. The root's adapter and production binding checks
passed, including source-call target and argument-channel assertions for actual
call/bind sites. Initial adapter fixture failures exposed non-strict TypeScript's
`any` bound return and a noncanonical fixture RecordRef comparison; both were
corrected. The binding cold/warm fixture passed in 17.3 seconds before the final
shared checks. Only corrected passing runs are acceptance evidence.

Final affected checks and the documented local gate passed as recorded below. Workspace `.testLogs/` and `/workspace/.wasm-setup/` logs are historical
author receipts, not artifacts promised in a clean checkout. No repository-scale
index, benchmark, native crash investigation or repeated broad validation campaign
was run. Hosted CI and broader platform/release acceptance remain separate.

## Remaining

Runtime object/escape certainty, stronger heap updates, complex completion and
async/generator protocols, dynamic or cross-source bound captures, dynamic endpoint
correlation and RPC protocol semantics remain open. WASM's documented binary limits,
validator/proposal support and runtime storage/activation uncertainties are unchanged.
The inherited cache-reader identity assertion conflict belongs to the separate
recovery owner and is not counted as passing. Other language adapters and estimator
calibration remain outside this checkpoint.

## Final checkpoint evidence

Implementation commits:

- `bf180a65`: object aliases, call/apply/bind adaptation, type-only parameter ordinals
  and explicit provider declaration alias channels.
- `4441345e`: WASM shared byte-view, instance/promise escape and malformed authority
  corrections, including host callback ordinals.
- `3e2c8049`: bounded browser transfer and relay candidates.

The final combined 15-case affected batch passed with no failures, retries, skips
or timeouts. It includes all eight new fixtures plus compiler production/CFG/call
summaries/invocation, deferred WASM production, host completions and analysis identity.
The batch took 44.4 seconds total; every case stayed below 30 seconds, with the
cold/warm compiler binding fixture slowest at 17.6 seconds. Helper-owned adjacent
checks additionally covered existing object effects, dispatch alternatives, browser
and Node workers, worker production, provider joins and WASM host/source admission.

The documented local front gate passed formatting, config budget, environment
usage, generated-surface freshness, command/workflow contracts, all 39 gate cases
and the final whitespace check. The gate lane took 16.2 seconds; the slowest case
was 5.94 seconds. No implementation changed after the final affected batch/gate;
only this receipt was completed. The roadmap is within its 20 KB contract.

PR554's hosted gate was in progress at the last readback; that is not CI acceptance
for this unpublished precision branch. The proposed next destination is
`codex/semantic-capabilities-20261011`; publication of this follow-on needs separate
approval. No merge or retarget is authorized by the checkpoint publication.
