# Semantic trace continuation ownership

Trace and explain pages retain immutable ref/context state. A persistent AVL
visited tree preserves context-sensitive traversal/evidence identities. A
persistent two-list FIFO shares pending items across forks and drops processed
items from newer frontiers. New refs/contexts are copied once after byte
admission; resume and snapshot share frozen roots instead of cloning old history.
FIFO reversal copies frontier links when needed, reusing immutable items.

The internal default state allowance is 8 MiB of conservative logical bytes,
separate from response bytes, depth, records, edges and the 16,384-visit ceiling.
Ref/context payload size is charged independently of the visit-key length before
cloning. A refused new visit retains the existing `visited_budget` frontier and
partial status. No source tokens/rows are silently treated as visited. Node/item
headers and UTF-16 text enter logical accounting; it does not claim measured
V8 heap/RSS, nor an aggregate limit on concurrently executing requests.

Saved state defaults to 32 MiB per service. Each trace or explain runner shares
one 64 MiB retention owner across its repository/policy services. Snapshots are
charged conservatively in full even when physical subtrees are shared. TTL,
cursor-count and byte eviction remove the original service's cursor together
with its accounting lease. Service-cache retirement releases its retained
snapshots; a retired in-flight service cannot publish a new cursor. No public
configuration/CLI fields or response schema are added.

Reading a cursor does not consume it. Earlier cursors can be replayed or forked
concurrently while retained; each page mutates only its private facade. Count,
TTL or byte pressure can expire an earlier cursor, producing the existing
explicit expired-cursor error. Request/generation/backend/inventory/query identity
is still checked. Internal cursor-policy identity includes the state allowance.

Work timing starts before service request capture, validation, hashing and
resume. Admission/AVL/FIFO/snapshot work shares that page interval. Snapshot
publication remains deferred until original reader cleanup and final response
projection succeed. Failed/cancelled pages never install a new cursor or evict
the last delivered cursor merely by preparing a provisional result. Oversized
aggregate admission is checked before local eviction. Long-lived retirement
callbacks are constructed outside page activations and retain no hydrated
response or query-store locals.

`continuationStats()` exposes internal logical retention, cursor counts and the
last page's allocation/comparison/copy/frontier counters for focused tests.
Nine state/actual-graph controls are authored and unexecuted, alongside existing
trace/explain parity, API, evidence traversal and reader-publication negatives.
Actual correctness, aggregate behavior and serial CPU/heap qualification remain.
