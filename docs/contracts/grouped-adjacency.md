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
The original adjacency transition and exact group maintenance must
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

## Affected-group maintenance

The original adjacency owner supplies coalesced signed support changes. A private
index points to each immutable group's complete alternatives. Sparse revisions
copy and update only affected groups, recount their exact weighted supports and
distinct values, and choose min/max from every surviving alternative. Unchanged
groups reuse their original aggregate/provenance identity. Removing an extremum
or the last support cannot leave a stale winner. The final group count is admitted
after every removal, so a same-size group replacement is independent of edit order.

A deterministic cost estimate includes retained groups, affected alternatives and
edits. Dense revisions use the full recomputation path. Both paths share report
sealing, output relation construction, the original byte/work limits and exact
logical identities. Coverage-only revisions update observed/exact statuses and
actual emitted facts without re-aggregating parent alternatives. Hashes are reused
only for unchanged groups from the same original operator owner; public copies
cannot supply those identities.

Work observations separate actual row/comparison visits, affected group count
and newly computed group-provenance hashes. They exclude work still owned by
input validation, canonical report sealing and factor construction. These are
bounded operation counters, not end-to-end latency or memory measurements.
Four additional locally unrun controls compare both endpoint directions, weighted
and extremum retractions, dense fallback/resumption, partial-domain transitions,
atomic replacement, budgets/replay/cancellation, every parent field, clean-rebuild
relation roots and an independent tiny-copy aggregate oracle. A 200-support
unchanged group makes accidental full recomputation observable. General elastic
composition, calibrated cost history, spill and semantic invalidation remain open.
