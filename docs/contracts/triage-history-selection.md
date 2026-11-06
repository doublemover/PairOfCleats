# Triage history selection and continuation

`src/contracts/triage-history.js` owns the strict version-one selection/cursor
schemas and limits. Context packs retain their `history` records and add a
`historySelection` envelope whose items identify each source decision, original
finding link, relation, matched fields, score, route and historical validity.
The ranking policy is `exact-lineage-route-affinity-v1`.

An explicit finding link within the selected record namespace is exact lineage.
A conflicting repository or original finding-observation identity disqualifies
that relation. Missing observation receipts remain unknown. Vulnerability,
package, common manifest basename and route matches are related precedents;
they never establish entity identity. The decision source `manual` is not
mistaken for the original finding's ingestion source.

The initial allocation reserves `ceil(limit / 2)` records for exact links, ranked
by newest authored timestamp then ordinal record ID. Related records fill the
remaining allocation using the existing route-first affinity weights, timestamp
and ID. Unused related slots can return more exact links. Exact ties use the
same deterministic ID policy regardless of read completion/directory order.
An exact prefix never skips a fitting-budget refusal to manufacture a later
continuation boundary. No decision is selected as an automatically current
verdict, approval or suppression. Conflicting statuses/reviewers are retained.
Expiry and future authored timestamps are qualified against the envelope's
explicit `asOf`; supersession remains unverified. Route drift and original/current
finding hashes are exposed only at their actual available observation strength.

Selection uses one directory scan and the existing four-read admission owner.
Each original canonical read retains its 16 MiB limit. Initial/continuation output
has at most 256 records and 1 MiB compact JSON for **history plus selection**;
the existing configured `maxHistory` can select a smaller result. This does not
bound other context-pack sections, pretty-printed output or process heap.
Three bounded lanes retain at most `3 * limit` candidate wire bodies and 3 MiB
of charged record/item bytes, plus one transient insertion and admitted reads.
Names, queue bookkeeping and compact snapshot digests remain O(N); record bodies
are not retained for the corpus. Metadata reserves 32 KiB inside output admission.
The final exact compact byte count is checked after projection. No public
capacity knob, larger read allowance or retry is introduced.

Coverage reports admitted candidate counts, omitted/oversized records, read
failures and whether counts are lower bounds. Disabled history performs no
directory/candidate reads and does not claim an exhaustive empty result.
Ordinary read failures retain bounded diagnostic samples and prevent continuation;
pending successful or failed native/resource observations propagate through the
existing settled queue instead of becoming incomplete-success warnings. Directory
entries are captured before awaits; the original directory and record observers
remain required across callback completion and before further native dispatch.

When pageable exact links remain, the compact cursor binds policy, repository,
record namespace, finding content/observation, as-of time, effective budget, a
digest of the observed public-record contents/names and an actual exact decision
boundary. It contains no source paths and grants no filesystem/mutation authority.
Each continuation performs one fresh bounded-concurrency scan, refuses changed
or incomplete observations and returns only the next exact page. It does not
promise a transactional filesystem snapshot or retain a cursor-side corpus.
Oversized decisions stay explicitly unavailable through this projection; they
are never silently treated as delivered. Related-history pagination is not
promised by the exact cursor. `earlierExactPassed` counts positions before its
boundary, not a claim those records were delivered to another client.

`tools/triage/context-pack.js --history-after <json>` consumes this versioned
cursor, with a 32 KiB input limit and strict fields/types. A changed finding,
root, budget, record set or unknown boundary requires a fresh initial selection.
This adds an explicit continuation surface; it does not relax existing record,
request, authority or error contracts. The CLI and fixtures use only
`history-selection.js`; the unused affinity-only selector has been removed.
The bounded-selection fixture checks an independent exact/route/score/time/ID
oracle, all three retained lanes, four-read admission, bounded redacted failure
diagnostics, zero/invalid budgets and real canonical reads. The ingest/decision
matrix verifies matching a nonrepresentative affected package through this same
production selector. Contradictory record/file identities are refused by the
canonical snapshot reader rather than resolved by directory ordinal.

New decision Markdown uses renderer 2 and includes the original finding link and
historical interpretation. Stored renderer-1 generations verify with their exact
original renderer. Reimport can publish renderer 2 while retaining the old
immutable evidence. Records producer version 11 invalidates derived old meaning.
Seventeen focused controls and strengthened actual context CLI coverage are
authored; functional and resource/latency qualification remain pending.
