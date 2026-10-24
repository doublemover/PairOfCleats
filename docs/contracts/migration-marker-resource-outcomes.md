# Migration preview and cleanup marker resource outcomes

Status: UNVALIDATED source and authored controls, 2026-10-23.

`assertSafeCacheDeletion` reads the ownership marker through the existing bounded
contained descriptor owner, with the same 64 KiB marker limit as authority
snapshots. Parsing and owner/layout checks follow confirmed descriptor closure.
The launch-supplied roots, existing platform aliases and no-link checks still
establish the permissible scope. A marker never adopts another storage tree.

Settled missing, malformed, oversized or incompatible markers remain unmarked.
An original pending callback, unreadable lifecycle getter, throwing observer or
failed descriptor close propagates with its original causes and actual contained
descriptor capability. Such failure stops before checking another candidate root.
The explicit `allowUnmarked` option retains its existing launch-owned behavior.

Migration previews use the existing failure observer before turning authority,
location, category-inspection or manifest failures into blocked-plan diagnostics.
An absent/false pending flag cannot cancel an original release observer. Diagnostic
getter failures preserve both the primary and independent secondary observations.
Category inspection captures the selected owner method and receiver once; returned
receipts must satisfy their original resource observation before and after their
quiescence, portability, permissions and identity fields are inspected. This adds
no category owner or release authority. Generic cache/repos/CAS/state/config tree
migration remains prohibited.

`tests/shared/storage/migration-marker-resource-outcomes.test.js` authors actual
disposable marker, contained numeric descriptor and preview consumer controls:
ordinary marker/owner failures; callback-only and throwing lifecycle observations;
secondary diagnostic failures; first-close recovery after pending reads; failed
numeric-close nonretry; original-method/observer replacement; and authority,
category and manifest failure propagation before later work. The existing frozen
migration/rollback fixture still checks exact primary containment and all original
copy, journal, locator and recovery assertions.

No runtime controls were executed. This is not cross-process cleanup/migration
acceptance. Marker validation and later filesystem mutation remain separate
operations; portable pathname comparison cannot make their intervening race
atomic. Failed synchronous numeric close cannot be retried safely after uncertain
descriptor reuse. Explicit recovery never rereads a marker, runs an inspection
again, grants permission equivalence, applies a plan or deletes source bytes.
