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

Call-graph SCCs do not prove information-dependency closure. If a later reverse
edge dirties an already-processed component, its summary and the group remain
unconverged with `call_summary_information_dependency_unsettled`. No old fixed
point is promoted or silently reused. Full affected information-SCC recomputation
is still pending under #1132. Manifest version3 retains these analysis reasons
separately from execution-ownership reasons; persisted admission rejects older
formats. The shared callFlow producer must advance for these scheduling/partial
outcome and evidence changes.

The worklist retains at most a component-sized heap/queued set, next-round set
and position map. `componentMembershipChecks` records selector work separately
from derives, reverse-edge visits, aliases and call instantiations. Deterministic
counters do not establish CPU/heap or end-to-end benefit. The authored
`tests/indexing/semantic/call-summary-worklist-parity.test.js` compares the same
solver under both schedulers for chains, recursive effects/exceptions, unknown
remainders, rest arguments, zero/one rounds, document order and a later information
invalidation. It also checks a sparse selector round without a full member scan.
All controls remain UNVALIDATED; representative matched-completion measurements,
source-language acceptance and peak-retention campaigns are deferred.
