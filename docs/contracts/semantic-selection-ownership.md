# Direct semantic selection ownership

The artifact operation reader and SQLite operation reader capture the selector's
own data properties before validation, I/O or database callbacks. The two-field
immutable copy retains the existing field enum, 4096-character selector value and
page allowances. Artifact binary searches, request-local range keys and selected
row checks all use this one selector. Mutating a caller's selector cannot change
a range already registered under its earlier key.

The shared neighbor reader owns its RecordRef, direction, admitted edge kinds and
page option values before calling the related-row reader. It uses these same
values for endpoint filtering and incident-row cursor positions after the await.
Duplicate kinds remain accepted and retain their first-occurrence order, with at
most the existing finite kind enum retained. Signal and metrics objects remain
their original live identities; no resource session is cloned or reconstructed.
The callback receives an immutable reference and page envelope, and the retained
kind selection is immutable.

SQLite record projection also captures references and requested field groups.
Even though its SQL work is synchronous, its returned Promise must not expose a
reference that can later be relabeled through the original caller object. Related
SQL owner selection uses the same captured RecordRef throughout. Database handle
lifetimes and successful SQL ordering are unchanged.

Required selector, ref and kind entries are own data properties, so capture does
not call accessors or admit sparse entries. Reflection failures propagate with
their original identity. Existing operation TypeError and backend record error
classification remain. No schema, persisted producer, index or cursor version
changes are required. Store metadata, foreign callbacks, arbitrary Proxy work and
the work of scanning a duplicate-filled kind list are not globally bounded here.

Authored controls use actual retained operation/query indexes, mutate selectors
during physical reads, reuse the same scoped range, and project real ingested
SQLite partitions through caller-mutating database callbacks. They are
**UNVALIDATED**. Native, provider, runtime, full-index and performance qualification
remains open; no measured speedup or broad issue closure is claimed.
