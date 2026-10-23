# Compiler summary shadow manifests

The existing compiler call-summary solver can record version1 shadow manifests.
The compiler cross-file consumer registers one immutable group sidecar through
the existing semantic evidence inventory and disk account, then links it from
canonical analysis evidence. This is reusable instrumentation for #1132. It does
not enable summary reuse, narrow a production identity, enqueue refinement or
change a read-only trace into analysis work.

The initial payload domain is the finite powerset of input ordinals for return,
exception and field-effect channels. Order is subset inclusion, join is union and
bottom is the empty set. Receiver input uses ordinal `-1`; rest mapping retains
the existing argument expansion. Empty payloads do not prove no runtime flow.
Completeness, convergence, widening and unknown target remainders remain separate
metadata. Work exhaustion can stop a computation before its fixed point; domain
join laws alone do not establish bounded-transfer or whole-language soundness.

Each recorded declaration is qualified by its existing partition reference,
source identity/hash, whole local flow hash and policy hash. A path/span locator
helps inspection but is not a stable cross-edit identity. Group framing retains
all current flow/provider inputs, compiler context and dependency hashes, and
producer versions. Negative import/config probes remain protected by those broad
identities; this recorder does not replace their sealed dependency inventory.

The recorder captures visited reverse-input keys, including empty predecessor
lookups, and known/missing callee summary reads. Final predecessor sets describe
the fresh solver's completed or partial graph. It separately records generated
edges by caller declaration and call site; reusable callee payloads have no caller
identity. These are observed solver reads and contributions, not a complete
information-dependency graph or deletion-safe replay authority. In particular,
direct exception/effect payload joins are still represented by their final
payloads and callee reads, not a complete per-contribution retraction certificate.

Recording retains at most4096 charged entries and1MiB, including final projection
and framing. It uses bounded canonical encoding before retaining new leaves. A
budget overrun discards the entire shadow product and writes a small explicit
`unavailable` receipt. Solver dependencies, work/iteration limits and phase
coverage remain unchanged. Ordinary sidecar write/quota/cancellation failures
still fail through their existing owner; no recording failure grants completion
or bypasses publication. Products are immutable JSON and carry no AST/native
handles across owner boundaries.

Every recorded/unavailable manifest states `qualifiesReuse:false` and
`reuseGuard:"full-group-rebuild-required"`. Fresh solving starts with empty
dependency sets, so a removed sole seed cannot survive through an old recursive
fixed point. Per-summary body identity, complete reverse support, persisted
manifest admission, affected information-SCC recomputation and cross-generation
reuse remain pending. No speedup, deletion-safe incremental acceptance or #1133
plan/enqueue/drain support is claimed.

The analysis policy binds the local manifest version. The shared `callFlow`
producer version must also advance because canonical evidence now points to this
registered artifact. Domain-law, fresh edit/undo/removal, missing-read, budget,
actual TypeScript CFG/retained consumer, deterministic sidecar, broad-context and
cancellation controls are authored in
`tests/indexing/semantic/call-summary-shadow-manifests.test.js`. They remain
UNVALIDATED until the root-led integration pass.
