# Compiler session source indexes

The compiler session retains source-ID and normalized container-path indexes.
Embedded candidates additionally use the exact container/segment/range/text-hash
tuple. A hash only selects candidates: local length, retained text, parent range
and any explicit source ID must still agree. Multiple qualified candidates fail
closed. The ordinary path route now checks retained text just like the explicit
source-ID route; a known path alone cannot label different virtual source bytes.

Document digest memos retain the original immutable string value in a WeakMap.
Changing a document object's text invalidates that memo. Program source identity
uses an object/text-qualified memo and a separate normalized-path hash inventory.
Conflicting same-path Program sources are rejected; declaration lookup cannot
borrow a different object's cached path hash. All indexes and memos belong to the
existing session/group lifetime.

`identityStats()` reports deterministic lookup/candidate/digest counts for focused
inspection. It does not measure CPU, heap or checker work. The authored fixture
`tests/indexing/semantic/compiler-source-identity-index.test.js` covers1k/10k
ordinary identities,5/20 competing segment texts, memo invalidation, collisions
and the actual retained session preparation/context consumer. It remains
UNVALIDATED. Full0/5/20-segments-per-container corpus measurements, peak memory
and end-to-end compiler acceptance remain deferred; no speedup is claimed.
