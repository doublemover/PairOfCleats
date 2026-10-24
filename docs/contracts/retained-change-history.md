# Retained change precedent pilot

`scm/change-episodes/retained.js` accepts a deliberately supplied finite snapshot
comparison range. This first route does not resolve Git/JJ references or invoke
any subprocess, hook, diff driver, checkout, fetch or current-file fallback.
Snapshot IDs are full 64-digit hashes; the caller admits their membership and
ancestry. They are not reinterpreted as verified Git commit IDs.

Each episode identity includes repository, provider, after snapshot and selected
parent snapshot (or explicit root). Separate merge parents remain separate
episodes. Source sides distinguish present, absent, unavailable and binary.
Present sides are checked against owned UTF-8 source and the canonical manifest;
their blob identity is the retained source SHA256. Additions/deletions preserve
absence rather than fabricating empty files. Rename/copy candidates retain their
uncertainty and never union path identities.

Search reuses the existing query tokenizer for a small lexical intent-overlap
reference target. It filters admitted snapshot membership, episode availability
and observation time before scoring. Each original intent version, outcome and
explicit revert/supersession link is filtered independently by availability and
observation cutoff. Late backfills are conservatively excluded from earlier
cutoffs; authored timestamps do not override this rule. Intent text has a checked
digest and source-version identity; generated descriptions are not substituted.

Search results separate lexical score, historical outcomes and current applicability.
Every search result is `historicalOnly` with current conditions not evaluated and no
action authority. The context-pack `projectPrecedentApplicability` consumer joins
supplied named current predicates through the existing task-evidence support owner,
then applies the existing response budget. Historical-world checks cannot fill
current-world roles. All supported named conditions produce `conditionsSupported`
only in that explicit predicate scope; conflicts/unknowns remain visible and
behavioral transfer remains unestablished. Empty condition lists stay historical.
A historical green observation or changed test does not permit
applying a patch or claiming behavioral compatibility. Missing outcomes stay
missing; failed/reverted outcomes are searchable evidence.

Inspection hydrates only the selected retained before/after comparison. Prefix
previews carry exact UTF-16 spans, avoid splitting surrogate pairs and report
omitted characters. They are source comparisons, not a guessed hunk/rename map.
They cannot substitute today's file under an old path. Canonical retained text
remains available regardless of preview length.

The in-memory owner bounds members/episodes at 1024, source pairs at 4096,
intent/outcome inventories, source bytes and metadata bytes. Sources and their
serialized metadata are separately accounted; these are not heap measurements.
Publication is private and immutable. Durable append, source leases, lazy blob
storage, resumable ingestion and production index integration remain separate.

Authored unexecuted fixtures cover future and late-edited intent, late outcomes,
observed-time backfills, branch membership, parent-specific comparisons, source
immutability, unusual filenames, root addition, missing blobs and partial range
coverage and current support/contradiction/invalidation. Git/JJ adapters, canonical context-pack facets,
public schemas and chronological performance/utility qualification remain open
#1519 obligations. No tests or runtime checks have been run for this slice.
