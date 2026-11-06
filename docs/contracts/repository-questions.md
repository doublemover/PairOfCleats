# Typed repository questions

The read-only JSON AST compiler, finite reference interpreter and current-reader
executor compose recorded target candidates and parser-established literal
arguments under one Invocation binding. The CLI `repository-query`, MCP
`repository_query` and HTTP `POST /analysis/repository-query` share one runner.
The existing text search grammar is unchanged. Runtime qualification is pending.

The underlying operation index now has version 4 source-position keys, shared
with the existing SQLite discovery table. Segment-aware prefix enumeration
jumps between distinct indexed source paths; exact-path operation pages seek
after the last `(path, span, source-hash, record-ref)` key. Neither requires a corpus scan,
whole-file sort or offset walk. UTF-16 path units are hex encoded so JavaScript
and SQLite BINARY ordering agree, including astral and private-use characters.
Unknown-span expressions remain enumerable after positioned expressions.
This inventory covers expression-bearing retained sources, not every file in
the filesystem.

Earlier operation manifests are rejected. SQLite source-order reads require
the current projection version; published imports stamp it after all partitions
are ingested. Incremental application rebuilds unchanged canonical partitions
when their derived projection is old, then publishes the marker in the caller's
transaction. Discovery producer version 11 prevents old derived replay meaning.

`compileRepositoryQuestion` accepts schema version 1, an explicit immutable world,
one source-scoped Invocation scan, typed binders, a conjunction, a projection and
source ordering. The supported predicates are `recordedTargetCandidate`,
`declaredNameEquals`, `operandAt` and `parserLiteralEquals`. Operand positions are
zero-based syntactic positions. Scalar equality compares type and representation
without JavaScript coercion. A recorded target is a candidate, never a runtime
callee claim. Unsupported predicates, incompatible sorts, unbound inputs and
non-read-only/wrong-version capabilities produce positioned compile diagnostics.
Unsupported AST operators fail the closed request contract.

Exact paths and segment-aware prefixes retain case and literal filename spelling;
no Unicode, separator or display-name alias is used as entity identity. Prefixes
cannot escape the selected relative source domain. Declaration names are values;
equal names retain separate record identities. Constants remain data.

Logical plans normalize binder names and coalesce identical pure clauses while
preserving every authored clause ID and JSON position. Logical and physical
digests bind predicate versions/meaning and are distinct from the original request digest. The physical order respects
predicate input modes and correlates all predicates through the same bindings.
Only original privately branded, immutable compiled objects execute; deserialized
plans must be compiled again.

`executeFiniteRepositoryQuestion` is a reference oracle over explicitly supplied
records, candidate edges and operands. It never reads a repository, invokes an
external predicate or grants source-open authority. Its `supplied-finite-model`
verification label cannot establish live source or program-semantic completeness.
Missing scalar/operand information and partial domains remain unknown frontiers.
Refutations describe bounded observed clause failures; selected witnesses are not
an exhaustive support graph or a minimal/causal explanation.

The request is bounded to 16 binders, 64 clauses and 256 KiB of canonical input.
The model admits at most 1,024 entities, 4,096 targets, 4,096 operands and 2 MiB of
canonical input. Execution defaults to 65,536 indexed-record/comparator/join work
units, with a hard maximum of 262,144. Input validation/hash work has its separate
byte/cardinality bounds. Output projection/sorting is separately bounded to 128
rows and 64 KiB including the newline; projection comparisons are reported apart
from enumeration work. Admission precedes unbounded intermediate expansion;
depth-first frames retain at most one state per clause. Cancellation publishes
no successful result.

Answer enumeration, supplied-domain state and ranked-prefix completion remain
separate. Output/work exhaustion returns partial rows and explicit remainder;
it never manufactures a complete relation. Exact counts apply only to an
exhausted, fully specified supplied model. Program-wide counts remain null.
Every result carries the request, plans, world and input fingerprint so changed
origins or inputs cannot be mixed during later explanation/reconciliation.

Six authored fixture cases include a 256-model independent truth table, typed
zero/false/string controls, correlated-call counterexamples, duplicate names,
alpha-renaming and clause origins, world/coordinate authority, mutation,
unsupported capabilities, cancellation and bounded unknown results. Runtime
qualification remains deferred with the rest of the implementation pass.

The live profile is deliberately narrower than the finite compiler: exactly one
Invocation, one Declaration and one Literal; one recorded-target producer and
one syntactic-argument producer; optional exact name/scalar filters; all three
binders selected with the Invocation first. Unsupported projections or additional
producers return original-clause diagnostics before indexed operation reads.
Disjunction, negation, semantic type/effect/path predicates and relaxed-query
experiments are not admitted by this profile.

First submit a description request, replacing the repository and generation with
the exact retained build selected by the caller:

```json
{"schemaVersion":1,"repoRoot":"C:/repo","generation":{"baseBuildId":"build-id","semanticRevision":0},"mode":"describe","scan":{"sourcePrefix":"src/http","invocationKind":"call"}}
```

Run `pairofcleats repository-query --request describe.json`. Use the returned
`world` verbatim in the typed question, then submit the same envelope with
`mode: "execute"`, `question`, and optional bounded `limits`/opaque `cursor`.
`--all` streams every bounded page as JSONL while honoring output backpressure.
MCP and HTTP accept the identical closed JSON union. Request-file reads are
contained, descriptor-owned, fatal-UTF-8 decoded and bounded to 512 KiB.

This profile's repository namespace is the canonical authorized reader root; its
source snapshot is the admitted partition-inventory digest. The context scope
explicitly includes all retained provider contexts; each selected target witness
retains its own context and certainty. The domain digest binds normalized source
paths/prefix and invocation kind. These values do not rename individual source
units or merge different provider contexts into one runtime conclusion. A world
mismatch requires a fresh description and compilation.

Each page uses the existing operation, related-row, record, coverage and source
header readers. Compiler target edges attached to call occurrences are joined
only through that occurrence's exact Invocation reference and call/construct
role. Direct invocation edges are handled separately. Target call-site identity
is checked; matching literals from another call cannot satisfy the join. Equal
candidate declarations from several contexts yield one binding tuple with one
selected witness, while different declarations with the same name remain rows.

A page first collects one Invocation's bounded target/literal reference sets,
sorts their source keys, then streams the selected Cartesian output without
materializing it. Bounds are 4,096 retained candidates per side and 8 MiB of
conservative logical state per Invocation. Admission precedes retention; an
oversized set fails explicitly with detail/narrowing guidance. It never drops
alternatives or certifies a truncated result. Page work allows at most 512 bounded
state advances, each reading at most one related row; bounded reference sorting
and validation/hash work are included in elapsed time. No latency improvement
is claimed before serial qualification.

Cursors retain only refs, source sort keys, exact reader positions and bounded
qualification facts. They bind the original request/clauses, logical/physical
plans, world, backend, store inventory and configured policy. Replayed cursors
fork private state. Shared TTL/count/byte retention is at most 64 MiB per runner;
service retirement returns its leases. Reader cleanup and final projection must
settle before a new cursor can become visible. Failed or cancelled pages leave
previously delivered cursors usable until ordinary eviction/expiry.

Every emitted tuple rechecks its retained witnesses and source headers. Its
stable row identity and semantic-detail request support expansion through the
existing detail/source readers. Header qualification establishes indexed source
identity and coordinates; it is not a verified source quotation. Mapped/binary
coordinates, external source-less declarations, unavailable scalars and oversized
values produce explicit unknown diagnostics. Exact refutations describe only
retained clauses. The diagnostic list is a bounded selection with omitted counts;
execution diagnostics are not a causal or exhaustive why-not explanation.

Enumeration, observed analysis coverage and program semantics remain separate.
Exact totals count only an exhausted retained relation with no unresolved
bindings, never all runtime calls. Unknowns across earlier pages retain a count
and final frontier even after enumeration ends. A byte/work remainder is
resumable; an exhausted unknown relation has no fake work cursor. Ranked-prefix
and program-semantic completion are never established by this exact-fact profile.

Eight indexed cases are authored and unexecuted: real artifact/SQLite/oracle
parity; correlated calls and scalar types; source/operand unknowns and original
clause positions; replay/expiry/world/backend authority; falsey close failure and
publication ordering; retention/cancellation/oversized candidate state; physical
profile admission and wrong-call witnesses; and CLI/MCP/HTTP parity with streamed
backpressure. Existing source-open and semantic reader coverage remains in place.

For a complete original tuple, `mode: "explain"` accepts the same typed question
plus `bindingRefs: {invocation, declaration, literal}`. The Invocation must be
inside the original source domain and have the requested invocation kind. Every
ref must belong to the opened immutable generation and have its declared sort.
The explainer evaluates all compiled clauses at those exact refs, including name
and scalar filters after a failed target/operand join. It does not search for a
different tuple or silently relax the question.

Explanations reuse the production target/operand reader and continuation owner.
They collect the bounded call facts without the conjunction optimizer's filter
short-circuit, then report each clause as satisfied, refuted in retained input,
or unknown. Refuted membership requires exhaustion of that retained call's
facts; incomplete source/operand qualification stays unknown. These are not
runtime absence, type/effect, feasibility or causal claims. Equivalent compiled
clauses retain every original authored ID/path in the shared origin map.

Explanations page with the same byte/work/retention limits; `limits.records`
bounds returned clauses in this mode. Each page rehydrates the three selected
bindings and verifies selected witness positions. Cursors bind the full tuple,
question, mode and backend and publish only after reader cleanup. Original
expected and retained actual name/scalar values remain typed. Final clause
completion and overall conjunction truth are separate from analysis coverage
and program semantics; a refuted conjunct can decide the retained tuple even
when another conjunct remains unknown. Three authored, unexecuted cases cover
same-call truth, independent failed clauses, duplicate clause origins, source
unknowns, scope/sort negatives, SQLite parity, cursor authority and CLI/MCP paging.
