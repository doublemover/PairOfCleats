# Finite support-aware repair

The #1516/#1524 repair consumer uses [positive-rule views](finite-positive-rules.md)
as an inert finite rollback model. A problem pins the original private baseline,
world, investigation/task/branch/assumption revisions, proposed atomic support
changes, permitted reversions, forbidden facts and facts that must remain true.
It neither changes source nor executes an experiment. Supplied source references
remain model inputs; this mechanism does not admit real program or causal truth.

At most 16 independent support additions/removals define the complete candidate
domain. Reversion is allowed only for explicitly permitted edits. Duplicate edit
identities, repeated support targets, nonexistent removals, existing additions,
invalid EDB supports and contradictory outcome requirements are rejected. Every
candidate starts at the original support set, applies the unreverted changes and
fully recomputes the positive least fixpoint and direct producers. Boolean facts
that remain true do not become frozen explanatory leaves.

`replayPositiveRuleRepair` validates any admitted candidate completely, regardless
of search progress. The search enumerates every permitted reversion subset and
minimizes reversion cardinality, then declared nonnegative integer user cost, then
stable edit IDs. A completed search proves the minimum only in this declared
finite domain. An interrupted page may still return a valid incumbent, with
optimality unresolved and the exact unexamined subset frontier. No proof-height,
local solver flag or partial proof enumeration establishes a global optimum.

Each page admits at most 256 candidates, 250 ms of cooperative work between
bounded candidate replays and 128 KiB of JSON output. The shared semantic
continuation-budget owner retains the original problem and private checked prefix
under TTL/count/byte limits. A conservative 20 MiB problem charge includes the
bounded baseline producer relation and captured metadata; each cursor adds 16 KiB
for state. Replay forks old cursors while retained. Expiry, eviction, a foreign
owner/problem or changed task/branch/constraints require restarting. Wire objects
cannot assert that a prefix was checked. Deferred publication uses the existing
semantic-page owner so failed final projection/cancellation cannot publish a
continuation. There are no retained native readers or handles.

Work reports baseline kernel counters, problem preparation and the initial
proposed replay, all candidate replay counters, search time, the separately
replayed emitted incumbent and serialization work. Baseline capture/construction
time remains caller-owned and is explicitly unmeasured here. This complete
forward strategy uses no reverse materialization or external solver; it makes no
incremental speed claim or comparison against an uncharged cold baseline.

Four unexecuted regression cases include an independent all-Horn-closed-valuations
oracle for all 16 reversions of `−A,+B,+X,+Y` under `P←A; P←B; F1←P,X; F2←P,Y`.
Reverting `+B` alone removes both faults although P was true before and after the
proposal. Requiring P to remain true changes the minimum to reverting both `+X`
and `+Y`. The cases also retain cost ties, inadmissible/infeasible domains, private
cursor replay/eviction/publication, byte bounds, strict contracts and cancellation.
Runtime qualification is pending.
