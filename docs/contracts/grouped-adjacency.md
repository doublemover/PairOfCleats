# Finite grouped adjacency

Input revisions preserve the original [support-history binding](adjacency-support-history.md).

The closed offline adapter `finite-grouped-adjacency-v1` uses the original
adjacency-view owner. It groups either endpoint and reports support count,
natural-number weighted count, distinct opposite endpoints and code-unit
minimum/maximum. Every original occurrence/support, endpoint, multiplicity and
source reference remains an immutable alternative. Retraction of an extremum
therefore reveals the next retained alternative; removing the last support
removes the group. Counts use exact BigInt arithmetic with the existing
128-digit coefficient bound.

Complete captured inputs produce one aggregate occurrence per group. Derived
facts carry no source authority of their own; their parent alternatives remain
in the report. Incomplete inputs report observed counts/extrema separately and
emit no falsely exact aggregate facts. Completing or losing captured-domain
coverage updates those facts even without support edits. Neither state implies
semantic closure outside the declared input domain.

Both initial state and revisions require original immutable handles and strict
passive definitions/batches. Shared finite-view capture rejects accessors,
proxies, hidden decorations, copied handles, stale bases and changed replays.
The bounded canonical encoder checks the supplied finite-view value guard before
inspecting each nested container; input/delta-row/array proxies cannot execute
traps during capture. Ordinary JSON encoding, content hashes and schemas retain
their existing meaning. Other canonical consumers keep their existing policy.
The original adjacency transition and full affected-view recomputation must
both succeed before a new private view is returned. Cancellation, work and
retention limits preserve the previous view. Exact replays never reapply a bag.

This finite owner admits at most 256 supports/groups, 1 MiB of retained report
and ledger data, 65,536 work units and 128 revision IDs; callers may tighten
these allowances. It uses the existing factor relation and delta owners, has no
publication pointer and introduces no persisted producer format. It completes
the bounded grouping operator under #1516, while general elastic selection,
spill, semantic invalidation and production-scale qualification remain separate.

Six locally unrun cases cover actual adapter registration, weighted provenance,
extremum/last-support retraction, partial-domain transitions, atomic replay and
original handles, cancellation/bounds, and an independent tiny occurrence-bag
oracle with fresh relation-root parity at every revision. No latency or broader
native/model acceptance is inferred from these authored controls.
