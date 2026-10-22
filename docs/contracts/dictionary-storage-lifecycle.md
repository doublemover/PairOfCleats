# Dictionary storage lifecycle

This is authored source, **UNVALIDATED**. No user dictionary, migration,
download, subprocess or regression execution is acceptance evidence yet.

Dictionary path enumeration declares the existing configuration-selected root
and holds an existing scoped repo-access lease while awaiting its filesystem
work. `dictionary-wordlists.js` separately holds a scoped lease across each
actual ReadStream until the `close` event. Completing readline iteration or
requesting destroy cannot settle ownership. A failed native close retains the
lease and error reconciliation handle. Signature stat operations retain their
own awaited lifetime. Storage exclusion/admission failures propagate instead of
becoming an empty successfully loaded dictionary.

The reader, downloader writer and category migration owner share
`<getApplicationHome()>/state/storage-access`. Arbitrary explicitly supplied
external dictionary files and bundled repository assets remain external; file
contents and path-name guesses cannot nominate a managed root. The path/config
owner registers the root; enumeration alone does not prove reader coverage.

The real category adapter recognizes the complete `dictionaries.json` producer
shape and exact local consumer bytes, including downloaded root text and durable
repository, slang and code dictionaries. All durable bytes are copied and
retained. Manifest path escapes, missing referenced files, unknown metadata or
files/directories, unreadable/partial inventory and unknown/live leases block
admission. Source download hashes are preserved metadata; verified migration
checks the exact local bytes consumed, including downloader newline handling.
This adapter grants **no cleanup authority** for user dictionaries.

The existing migration journal/copy/hash/immutable-publication/locator/rollback
owner performs transfer. Dictionary migration inspection receives the exact
exclusion lock IDs from that existing owner and can disregard only those bound
locks, preserving all other reader/writer protection. CLI apply/rollback require
the exact reviewed plan plus the same explicit home, category, source and
destination. The source and both copies after rollback are retained.

An explicit internal permission owner is required. Windows reports
`windows-destination-acl-owner-proof-required`. POSIX mode/uid/gid observations
also cannot infer ACL/xattr equivalence. There is no consent knob, ACL mutation,
elevation or stat-based permission qualification. The authored fixture supplies
its own task-directory permission owner solely to exercise source copy and
rollback; that is not platform permission or runtime acceptance evidence.
Tooling/model category qualification and generic registry/CAS migration remain
with their dedicated owners.

Dictionary reader failures preserve their original operation error when actual
stream cleanup also fails. The cleanup evidence and retained lease handle stay
attached to that primary error. A bounded reader pool likewise drains admitted
siblings and attaches their failures; any pending sibling marks the terminal
primary error as pending ownership. Such errors cannot be swallowed as optional
missing dictionary files merely because the original code was a read failure.
Frozen or readonly primary errors use an aggregate whose cause and first member
preserve that exact primary object; pending sibling handles stay attached.
Nonarray diagnostic metadata is retained on its original error, not interpreted
as a list of failures.
Pending failure composition captures the primary's original closure observer
and every added pending observer before publishing an aggregate predicate. Every
captured owner must confirm closure; missing or throwing observers stay false.
An earlier primary confirmation cannot release a later unsettled sibling.
This error/ownership propagation and its real-stream injected regressions remain
**UNVALIDATED**; successful dictionary word and case semantics are unchanged.
