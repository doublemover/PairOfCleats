# Occurrence-bag relation pilot

Unvalidated first slice of #1513. A flat reference provider uses the existing
immutable prepared-row owner and keeps occurrence/support/source identities,
nullable unresolved values and exact positive-integer multiplicity. Sum and
disjoint-attribute/atom-role product nodes share input handles without collapsing
bag duplicates. Decimal cardinalities use BigInt; no coefficient rounds at 2^53.

Lazy same-owner cursors enumerate exact occurrences through factor nodes, with
independent work/response windows. A paused page does not discard an occurrence.
Retained enumeration, captured-domain completeness and semantic closure are
separate. Explicit close releases the caller-supplied lease callback once; the
relation handle itself remains caller-owned. No new storage engine is introduced.

This in-memory reference slice does not claim optimized joins/seek, set support,
recursive provenance, output-sublinear execution or a measured heap bound.
Canonical descriptor schemas, store/lease adapters, sorted/adjacency providers,
spill/durable cursors, provenance/negative reads, full operators, planner and
measurement remain outstanding. Overlapping original atom roles cannot multiply
through a decomposition; a future semijoin is an existence gate, and actual
self-joins require distinct role and attribute identities.

The flat independent product/bag fixtures are authored but unexecuted.
