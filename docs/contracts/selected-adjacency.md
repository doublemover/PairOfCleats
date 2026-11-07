# Finite select/project adjacency

Related operators: [join/anti-join](relational-join.md) and
[grouped adjacency](grouped-adjacency.md).
All consume the original [support-history binding](adjacency-support-history.md).

The closed offline adapter `finite-selected-adjacency-v1` selects exact endpoint
equality and projects either original endpoint into each output position. Both
selection fields are explicitly null for an unfiltered view. Arbitrary callback,
regex, expression, source execution and unknown definition fields are unavailable.

Every matching original occurrence/support keeps its own derived support and
exact natural-number multiplicity, even when multiple parents project to the
same tuple. No set deduplication or copy expansion occurs during maintenance.
Coefficient-only changes preserve derived support identity. Parent endpoints,
source reference and support identity remain in the report; derived rows claim
no new source authority. Known positive supports remain available for incomplete
captured domains, while that incompleteness stays attached to the relation and
cannot prove absence or semantic closure. World/coverage changes produce new
reader identities even when the visible tuples stay equal.

Select/project and grouped views share one code-owned finite unary transition
owner for passive capture, exact replay, original input admission, cancellation
and atomic replacement. Each operator retains its own private handles, budget
markers and result construction. Unknown errors cannot impersonate allowance
receipts by copying a code. Failed work returns the prior view unconsumed; no
partial result or publication pointer is installed.

Default bounds are 256 input/output supports, 1 MiB of retained report/ledger,
65,536 work units and 128 revision IDs; callers may only tighten them.

Bootstrap and dense revisions recompute the full affected view. Sparse revisions
can update the retained selected supports directly from the original adjacency
owner's coalesced signed changes. A deterministic cost estimate includes retained
rows, changes and ordering work; it selects this path only when cheaper than
examining the current input bag. Coefficient-only updates reuse derived support
identities; unmatched changes require no projection. Changed world/coverage and
zero-edit revisions still seal a fresh exact result. Both strategies use the same
report, relation construction and byte/ledger bounds, preserving logical hashes.

All removals precede final output-cap admission. Replacing one support at a full
one-support cap therefore succeeds regardless of edit order; a larger final bag
still fails without consuming the original view. Work counters cover the chosen
operator's actual row/comparison visits and derived support hashes separately.
Original adjacency validation and full report/relation sealing remain required;
these counters do not claim total edit latency or a production speedup.

The [composed view owner](view-composition.md) adds transactional operator DAGs.
This supplies finite select/project maintenance under #1516; general relation
arities, calibrated strategy history, spill,
source invalidation and production qualification remain.

Six locally unrun cases cover the registered adapter, exact selection/swap,
duplicate projected bags, parent/coefficient identity, retraction, incomplete
domains and changed worlds, passive atomic replay, budgets/cancellation, an
independent expanded-bag oracle and fresh relation-root parity at every revision.
Existing grouped-view cases retain the same transition controls through the
shared owner. Four additional locally unrun cases compare sparse maintenance,
dense fallback/resumption, coverage-only revisions, atomic replacements,
limits/replay/cancellation and clean-rebuild roots with independent copy-level
output. Their selective fixture has 201 input supports and one retained match;
operation/hash counters are distinct from later serial runtime measurements.
