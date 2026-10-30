# Storage access diagnosis resource outcomes

Status: UNVALIDATED source and authored controls, 2026-10-23.

`inspectStorageAccess` keeps the existing repo-access coordination namespace and
owner schemas. It reads the existing cleanup and reader/resource lease records;
it does not create, acquire, reap, unlink or adopt leases. Durable resource leases
remain protected until their actual owner settles them, independently of PID death.

Lease and delegation read failures pass through the existing original-resource
observer before absence or unreadable-owner projection. An `ENOENT` code cannot
hide a callback-only observer, unreadable lifecycle getter or unconfirmed native
descriptor close. Ordinary settled malformed records remain protected diagnostics.
The common delegation guard enforces the same rule before either diagnosis or
existing admission/exclusion callers interpret the record.

Async lease enumeration uses `withStorageDirectory`. The original read/close
methods and actual Dir remain owned while each lease descriptor is inspected.
Pending nested file work prohibits actual directory close. On failure the existing
contained-file and directory capabilities preserve both resources; settle the
exact file and its prerequisites before requesting the first directory close.
Explicit close never rereads records, repeats enumeration, removes metadata or
grants cleanup authority. Only a settled missing directory before enumeration
starts is an empty inventory. An `ENOENT` during an admitted read is incomplete.

The authored public-consumer fixture
`tests/shared/storage/access-resource-outcomes.test.js` retains the no-directory-
creation and durable-owner positive controls. It covers original callback-only
observers on delegation, cleanup, lease and directory admission; actual nested
FD/Dir read and failed-close recovery without replay; method/observer replacement;
falsey ordinary errors; settled read `ENOENT`; and actual failed synchronous
delegation close with no unsafe numeric retry. Existing lease lifetime fixtures
remain unchanged.

No controls were executed. This adds no cross-process settlement proof, generation
snapshot, arbitrary PID/descendant census or new coordination owner. Enumeration
remains bounded to 10000 entries and is an observation of changing metadata, not
an atomic proof for a later mutation. Failed numeric synchronous close remains
unconfirmed even if a disposable fixture manually closes its own descriptor.
