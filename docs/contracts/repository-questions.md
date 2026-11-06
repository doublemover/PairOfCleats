# Typed repository questions

The initial foundation provides a deterministic JSON AST compiler and a finite
reference interpreter. It is not connected to live semantic stores, CLI, API or
MCP yet. Those adapters, durable/replayable result pages and advanced semantic
profiles remain implementation work under #1534. The existing text search parser
and its Boolean semantics are unchanged.

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
