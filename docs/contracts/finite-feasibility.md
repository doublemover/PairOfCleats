# Finite Boolean path feasibility

The initial #1527 producer checks named predicates in supplied, heap-free Boolean
SSA slices under `finite-boolean-acyclic-v1`. Its request/result schemas are in
`src/contracts/schemas/finite-feasibility.js`; the original target, advancement,
resume, explanation, invalidation and retirement owners are exposed by
`src/semantic/finite-feasibility.js`. This is an internal in-memory capability,
with no new command, public API/configuration surface, solver dependency or
repository-code execution.

The existing owned semantic source-snapshot admission verifies actual UTF-8
bytes, repository namespace, hashes, source identities and coordinate metadata.
Every declared source anchor must match those original bytes and exact nonempty
UTF-16 boundaries. Up to 16 snapshots share a 1 MiB source allowance; the captured
request also has a 1 MiB canonical allowance. The immutable target binds the
whole request and exact source set. Source-byte verification does not establish
the declared world as a current served generation or prove that the authored
translation preserves source executions. That qualification stays explicit in
every result. No existing graph path gains a feasibility claim.

The admitted operations are Boolean constants, copy, not, and, or, xor and equal,
predecessor-qualified simultaneous phi assignments, guarded/goto edges, Boolean
return/throw and named block reachability. Entry conditions bind distinct declared
inputs. SSA definitions are unique, every ordinary use must be dominated by its
definition, and each phi exactly covers its real predecessors with definitions
available on those edges. Names are never independently freshened across shared
input guards. There are at most 12 inputs, 64 blocks and 512 total instructions.
The full domain has at most 4,096 assignments, reduced only by explicit entry
bindings. Malformed graphs/SSA fail admission.

The candidate interpreter explores assignments deterministically. A separate
checker imports no candidate operation or input-enumeration helper: it replays
with numeric truth tables, its own input enumeration and a separate control walk.
A witness publishes only after matching independent replay of its input, complete
block trace and terminal value. Refutation requires both full candidate
enumeration and an independent false result for every admitted assignment.
Candidate corruption cannot directly mint a checked result. Refutation means
only that this named finite predicate has no witness in this supplied model.

Unsupported operations retain assignment/block/reason observations, capped at
16 with exact omitted counts. Cyclic control flow remains unsupported without
executing it; no bounded exploration becomes an unbounded safety result.
Unsupported semantics, an unverified candidate, failed independent checking and
budget exhaustion produce unknown. They never become an empty successful proof.
Mutable heaps, folded resources, function calls, coercions, recursive summaries,
bitvectors, enums and SMT are outside this first profile.

Each advance admits at most 256 assignment/checker visits and 250 ms of
cooperative work, yielding between complete assignments. A partial result retains
the exact next producer/checker indices and its original current cursor. Cursor
copies, previous epochs and overlapping advances are rejected. Cancellation
preserves the existing AbortError/cause contract and the last published progress;
the same original cursor can resume. Actual discarded/repeated work remains in
the run ledger. Cursor/model state is process-local and not a serialized resume
or cross-run authority grant.

Results retain source/world/anchor identity, independent outcome, unknown
observations, finite closure and work counts separately. Counts include actual
producer/checker assignments and visited blocks/instructions/terminators. Source
verification, preparation time and advance time are retained; these are bounded
operation observations, not representative latency, RSS or performance gains.
Successful publication validates the strict result and its 1 MiB + 64 KiB output
allowance before committing progress. Only original result handles are accepted
by the explanation owner. Source invalidation is explicit at this internal seam;
retirement drops private slice/index references and refuses further advancement.
Returned immutable historical results retain their source identities.

The existing lazy offline evaluation registry exposes this profile through
`createTarget`, `refine`, `resume`, `explain`, `claim`, `invalidate` and `dispose`.
It admits no arbitrary command, provider callback or fallback executor. The
scoped claim reader requires the original checked result, an active original
target, exact source set/world/predicate and `supplied-finite-model-only` scope.
Unknown, copied, stale and retired observations cannot grant a checked claim.
It exposes entry conditions and the complete finite input domain alongside the
named existence/refutation outcome, never a source-program absence claim.

Semantic claim IDs replay for equivalent judgments. Every target preparation has
a distinct execution UUID; receipt IDs bind that original execution and observed
epoch so repeated analysis cannot collapse as one actual run. Cached claim reads
still recheck current original target authority. Already returned historical JSON
does not become a persistent activation or revocation capability.

Nine authored cases remain locally unrun: shared contradictory guards, exact
source/witness capture, phi predecessor changes and exceptions, unsupported/cyclic
frontiers, all admitted operation truth tables, pagination/cancellation/overlap,
stale sources/retirement, deliberately corrupted candidate interpreters rejected
by the real checker, and strict SSA/source admission. No issue closure or runtime
qualification follows from these authored controls.
Two further unrun cases cover scoped consumer rejection, independent execution
receipts, registry controls, versioned old-read/new-write parity and duplicate
same-state output rejection.

Remaining #1527 work includes qualified source/compiler-IR translation and current
world admission, enum/bitvector and optional SMT profiles, demanded call summaries,
effect-qualified factorization, heap action laws, automatic dependency retraction,
durable owned-row publication and paginated analysis events. Explanation explicitly
reports event instrumentation unavailable. Source extraction and broader program
correctness remain separate qualifications.
