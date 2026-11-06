# SQLite semantic relation pages

Relation reads select qualified endpoints directly across the pinned immutable
generation. Interned names use their exact partition/local ID. Other relations
retain partition identity followed by physical rowid order, with self-loop
deduplication before pagination. Numeric offsets continue to count incident rows,
including rows later filtered by neighbor kind or direction. No public cursor or
artifact version changes.

Each request selects at most its existing row limit plus one lookahead. SQL
exports payload text only for returned rows whose individual and aggregate byte
allowances pass. Lookahead metadata determines completion without hydrating that
row. An empty nonzero-offset page checks one predecessor to distinguish the exact
end from an invalid cursor. No per-partition relation counts are issued.

Related records must belong to the admitted analysis inventory; orphan physical
rows cannot become visible. Existing schema and generation admission, structural
validation and endpoint verification remain. The schema adds endpoint-leading
indexes for occurrence, operand, ownership and edge pages. Existing databases
remain readable without those additional indexes; rebuilt databases receive
them. Older layouts therefore require separate query-plan/performance evidence.

Counters distinguish relation statements, returned hydration rows/bytes and
lookahead rows. These counters describe API work, not a claim that numeric offset
seeks or native SQL evaluation have constant cost. Large-offset/fanout behavior,
SQLite query plans and service cancellation still require the deferred runtime
qualification. Source implementation is present; no new passing test or measured
speedup is claimed during the frontloaded implementation pass.
