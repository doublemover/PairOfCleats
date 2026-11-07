# Optional embedding token estimates

The build runner and formatted passage wrapper share
`src/shared/embedding-token-estimation.js`. Counts remain
planning hints, not a target-tokenizer guarantee for complete rendered context.
Ordinary estimator failures still permit heuristic fallback. Native ownership,
cancellation, aggregate failures and failed inspection do not become a missing
estimate: the original result/error observations must remain settled at each
field boundary, and unresolved work propagates through its original owner.

The wrapper captures the estimator and its receiver once. It owns the returned
array before normalization, checks every original element, accepts positive safe
integer counts and uses the existing per-text fallback for invalid scalar values.
It does not invoke arbitrary object coercion to manufacture a count. A pending
interval cannot disappear because a later getter changes an observation.

The exact release function retains its original returned-array receiver. Valid
counts transfer that capability to the existing pipeline owner. Malformed ordinary
results release their known preparation before fallback. Release failures retain
the original result and actual cleanup error; cancellation/primary failures survive
independent cleanup failure. Unknown work grants no new automatic cleanup or retry.
The actual release error keeps its code/message as the primary diagnostic;
the retained estimate array cannot replace it with a generic storage message.

Five authored, locally unrun cases cover receiver identity, safe counts, negative
and malformed hints, ordinary/falsy fallback, native pending errors/results,
per-field observations, inspection failures and cleanup failure preservation.
The formatted passage wrapper preserves model prefixes and empty-input behavior;
it no longer catches terminal adapter failures as ordinary heuristic fallback.
Nested estimator wrappers preserve terminal identity even after an original
observation subsequently settles. This repairs lifecycle boundaries under #1765.
[Preparation windows](embedding-preparation-windows.md) address #779's separate
admission and row-retention owners; runtime/resource qualification remains pending.

Three additional, locally unrun cases exercise the actual `createEmbedder`
adapter boundary: formatted counts and original release receiver, ordinary
fallback versus cancellation, and original native failure through nested
estimators after late settlement.

Inline batching uses the same result guard while retaining its strict estimator
error contract. It holds vector results within the existing queue byte budget
and awaits original preparation release before resolving any successful request.
Requests joining during cleanup receive the same retained vector. Cancellation
can stop a waiter while teardown still awaits release. Provider and cleanup
failures remain together, including falsy rejections; unresolved original work
blocks subsequent admission and close until that original observation settles.
Release captures its receiver, verifies original settlement before and after
invocation, and runs once per returned capability without automatic retries.
Six additional locally unrun cases cover these boundaries and byte accounting.

Adjacent runner probes retain original failure observations before treating a
path/artifact/generation as missing, omitting maintenance size, reporting a bundle
refresh warning. Warnings use guarded diagnostic
fields. Ordinary missing/denied inputs keep their established fallback behavior.
Four additional unrun controls execute the actual probe bodies against ordinary
files and finite original-work failures; existing real SQLite cache coverage checks
that memory clear preserves persisted vectors. These models qualify the boundary, not an observed OS
handle leak. The unused local `readJsonOptional` closure is removed: all repository
references were its declaration, it had no export/indirect registration or dynamic
evaluation path, and no meaningful test called it. The unused persistent-clear
forwarding hook is also removed: the real text store exposes no such method, and
every cache-construction caller was inspected. Memory clear retains its existing
coverage and performs no persistent mutation. Other live JSON readers and their
coverage remain under their existing owners.

A stricter unused-binding audit also retires the empty source-hash Map, its
unconsumed cap/resolver and the old `boundedMapSet` helper. Repository callers had
already moved to `createLruCache`; only the obsolete helper fixture remained.
That fixture retains its ID/lane and now checks capacity, replacement and recency
against the actual production LRU. Two assertions that merely echoed the unused
hash-cap resolver are removed. Active file hashing, vector-source/cache identity,
pipeline miss telemetry and their meaningful coverage remain. Unread diagnostic
accumulators and unused imports/path/timestamp locals are removed without adding
new public telemetry fields or changing cache thresholds.
