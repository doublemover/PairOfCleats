# Compiler summary shadow manifests

The current local format is version4. Conservative existing-channel scheduling
dependencies are source-qualified declaration refs included in each support hash
and generation identity. They order a fresh solve and inform bounded demand
planning; they do not qualify cross-generation reuse or exhaustive dependency
support. See [the existing worklist contract](compiler-summary-dirty-worklist.md).

The existing compiler call-summary solver can record version4 shadow manifests.
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
source identity/hash, whole local flow hash, policy hash and broad dependency
identity. CFG extraction hashes bounded actual body/header ranges before dropping
the owner AST. A named lexical/header locator can survive a shifted or edited
body for comparison; duplicates remain ambiguous and anonymous/computed names
remain body-only. A path/span locator is not cross-edit authority. Group framing retains
all current flow/provider inputs, compiler context and dependency hashes, and
producer versions. Negative import/config probes remain protected by those broad
identities; this recorder does not replace their sealed dependency inventory.

The recorder captures visited reverse-input keys, including empty predecessor
lookups, and known/missing callee summary reads. Final predecessor sets describe
the fresh solver's completed or partial graph. It separately records generated
edges by caller declaration and call site; reusable callee payloads have no caller
identity. These are observed solver reads and contributions, not a complete
information-dependency graph or deletion-safe replay authority. In particular,
direct exception/effect payload joins now retain their observed input ordinals,
channel and originating callee/call site. Final payload, support and
generation-qualified identity hashes are checked independently. These observations
still do not establish a complete per-contribution retraction certificate.

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
fixed point. Persisted admission accepts only registered hash-qualified canonical
sidecars under the original contained-file owner, the current local format,
strict payload/support framing and the exact expected broad identity. Missing,
corrupt, incompatible or changed inputs require a group rebuild. A failed
descriptor close remains an original pending failure. Schema-compatible manifests
are immutable inspection inputs; admission still refuses reuse. Complete reverse
support qualification, affected information-SCC recomputation and cross-generation
reuse remain pending. The #1133 plan-only consumer is documented in
`compiler-summary-demand-planning.md`; enqueue/drain execution remains pending.
No speedup or deletion-safe incremental acceptance is claimed.

Fresh-solve analysis reasons are distinct from execution-ownership diagnostics.
In particular, a later information edge that invalidates a previously processed
call-graph component leaves its summary and group unconverged. The shadow product
records that blocker; it cannot promote the payload to a fixed-point certificate.
Admission also checks recorded byte/entry limits and group/member convergence
consistency. Field-effect paths preserve the established string, widened `null`
and exact private-brand `{private,source,owner}` key forms; arbitrary objects do
not become property keys. Repeated payload references are projected as sets.

The analysis policy binds the local manifest version. The shared `callFlow`
producer version must also advance because canonical evidence now points to this
registered artifact. Domain-law, fresh edit/undo/removal, missing-read, budget,
actual TypeScript CFG/retained consumer, deterministic sidecar, broad-context and
cancellation controls are authored in
`tests/indexing/semantic/call-summary-shadow-manifests.test.js`. They remain
UNVALIDATED until the root-led integration pass. Additional source/body-shift,
duplicate locator, persisted hash/schema/identity, false authority and original FD
controls are authored in
`tests/indexing/semantic/compiler-summary-persisted-admission.test.js`.
