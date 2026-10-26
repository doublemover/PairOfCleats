# WASM structure and optional flow

Decoded WASM structure has its own bounded catalog. Functions, storage and
instructions receive stable IDs before the stack/CFG solver allocates any block
or value. The catalog owns a bounded passive snapshot of the decoded module;
flow must consume that exact catalog rather than a lookalike or changed module.
Decoder/native validation, original-byte retention and existing source/publication
owners remain mandatory. Modules are never instantiated or executed.

The decoder records byte ranges for imports, function declarations/bodies and
storage definitions/segments. Structural evidence labels instruction, import,
body and storage ranges explicitly. Initializer/offset expressions retain their
decoded instructions as structure even when no flow is requested. Evidence
version 2 (`wasm-binary-structure`) retains one original binary, decoded module,
structural reference catalog and counts. Buffer and Uint8Array inputs retain the
same byte encoding.

Standalone structure is published in the syntax partition with the module marker
at local ID zero. Off, ungranted deferred and ineligible target modes do not call
the analyzer. Eager or granted eligible tasks add derived values, blocks, operands
and edges in their analysis partition, referring back to the same syntax IDs.
Structural rows, hashes and evidence do not depend on flow policy. Flow evidence
references the retained structural sidecar instead of duplicating source bytes.
Host projections use the same catalog/reference mapping, and cache failed flow
projection per creation so another member lookup cannot repeat failed work.

The original decoder bounds, four-MiB canonical/evidence admission and optional
flow caps (32,768 total nodes / 131,072 edges) remain. Structural records have a
separate 65,536-node bound derived from admitted binary structure. A flow-budget
failure leaves complete structural products in place and emits partial local-flow
coverage only after an actual attempt. Structural admission failure preserves
the module marker/original source with explicit partial syntax coverage; it does
not fabricate a flow attempt or replace off/deferred state with a solver failure.
Resource ownership and diagnostic failures propagate through the existing owner.

Construction counters distinguish decoded instructions, structural rows, attempted
flow, allocated/constructed work and retained flow products. Budget failure can
report discarded allocations; unavailable counters stay unknown. These counters
are not heap/RSS measurements or a throughput claim.

`wasmStructure: 1` owns decoder/catalog/syntax identity, separately from
`wasmFlow: 7`. Structural cache signatures use the structural version; analysis
and host projection use the flow version. Binary task inventory/dependency version
2 binds both producers and the native validator runtime. Old WASM products require
a normal rebuild; old task/source identities are not silently reinterpreted.
Deferred execution keeps the existing retained-source, generation and publication
fences and adds flow without rewriting structural meaning.

Six authored bounded cases cover off/deferred/ineligible/eager/granted policies
with the 256-local/128-block shape, plus small successful flow. They spy on actual
analysis admission, compare exact syntax rows/hashes, check physical byte ranges,
retain source bytes, validate cross-partition references and record construction
counts. Existing deferred-production assertions now also compare structural rows
and verify the initial absence of solver products. Existing flow, host, proposal,
source, cancellation, decoder and replay assertions remain. Runtime qualification
and performance measurement are deferred with the implementation campaign.
