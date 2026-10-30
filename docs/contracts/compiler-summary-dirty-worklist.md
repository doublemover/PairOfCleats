# Fresh compiler summary dirty worklist

The existing SCC solver now selects dirty members through an ordered bounded
worklist. A member dirtied after its position advances waits for the next round;
a later member can still run in the current round. This preserves the scan
scheduler's round/iteration semantics. The same transfer/joins execute in both
modes; `referenceSchedule:true` is an internal differential selector for fixtures,
not a production configuration surface or another analysis engine.

Source-qualified document IDs, summary IDs, call-site ties and call-graph
adjacency determine fresh-solve scheduling. Duplicate declaration identity fails
closed. Parameter/alias indexes, reachability dependency invalidation, source
qualified structural keys and the existing one-million work/iteration allowances
remain in the current owner. Return bits, exception/effect dependencies,
completeness and widening still participate in change propagation.

Before decomposition, the solver indexes its existing call-owned result,
exception-target and following-field-read write destinations. It follows the
existing reverse graph and prospective argument/receiver inputs to order readers
after potential writers, including initially empty lookups. The resulting
conservative information edges join the call graph for the existing SCC owner;
they never become value-flow facts. Construction spends the existing one-million
work allowance, and an information SCC retains the minimum existing member round
limit. `informationDependencyVisits` and `informationDependencyEdges` expose this
additional scheduling work.

A newly discovered edge outside that indexed domain still leaves its processed
reader unconverged with `call_summary_information_dependency_unsettled`. Manifest
version4 records conservative `schedulingDependencies` in support/generation
identity; its admission rejects older or tampered products. This is fresh-solve
ordering within existing channels. Qualified source-language dependency closure,
cross-generation contribution replacement and affected-only recomputation remain
open under #1132. Every production solve still starts from its current immutable
inputs and bottom dependency sets; no old fixed point is promoted or unioned.

The worklist retains at most a component-sized heap/queued set, next-round set
and position map. `componentMembershipChecks` records selector work separately
from derives, reverse-edge visits, aliases and call instantiations. Deterministic
counters do not establish CPU/heap or end-to-end benefit. The authored
`tests/indexing/semantic/call-summary-worklist-parity.test.js` compares the same
solver under both schedulers for chains, recursive effects/exceptions, unknown
remainders, rest arguments, zero/one rounds, document order and a later information
dependency. It also checks a sparse selector round without a full member scan.
The additional information-SCC fixture covers a non-call-graph cycle, fresh
removal of sole support, retained alternative support, undo, round exhaustion and
actual compiler/retained-sidecar consumption. The demand planner includes these
recorded dependencies in its existing bounded plan traversal and remains blocked
from execution and reuse.
All controls remain UNVALIDATED; representative matched-completion measurements,
source-language acceptance and peak-retention campaigns are deferred.
