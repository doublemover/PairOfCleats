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
65,536 work units and 128 revision IDs; callers may only tighten them. The
strategy is full affected-view recomputation. This supplies the finite adjacency
select/project operator under #1516; general relation arities, elastic operator
composition, spill, source invalidation and production qualification remain.

Six locally unrun cases cover the registered adapter, exact selection/swap,
duplicate projected bags, parent/coefficient identity, retraction, incomplete
domains and changed worlds, passive atomic replay, budgets/cancellation, an
independent expanded-bag oracle and fresh relation-root parity at every revision.
Existing grouped-view cases retain the same transition controls through the
shared owner. No measured speedup is inferred from these authored controls.
