# Cross-file canonical symbol replay identity

Cross-file resolution reads `chunk.metaV2.symbol`: its qualified name selects and
scores candidates, and its symbol, signature, kind and chunk identities populate
resolved references and candidate evidence. The cross-file cache fingerprint
therefore includes a stable hash of the entire supplied canonical symbol object,
alongside the existing source byte identity, chunk identity, relation payload and
docmeta identity. Missing symbols differ from present symbols; object insertion
order does not affect the hash.

Changing only a canonical symbol must recompute propagation before ordinary
output replay becomes eligible. A stable source digest or chunk UID does not
authorize replay of an obsolete resolved symbol, qualified name or return fact.
The fingerprint shape itself invalidates earlier cache keys. This change does
not alter resolution policy, a cache format, producer versions, cache limits or
the existing exclusion of unqualified tooling/source replay.

The authored regression exercises candidate-field changes, actual cold/warm
propagation, changed symbol IDs and removal of a candidate through a qualified
name change. These controls remain **unvalidated** in the development-first
workspace. This contract does not qualify provider/config identity, arbitrary
external mutation during a run, process memory or runtime performance.
