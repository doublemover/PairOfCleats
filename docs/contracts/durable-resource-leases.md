# Durable resource settlement leases

Resource admission reuses the existing repository/category reader and exclusive
cleanup handshake. Scoped storage sessions and retained physical managed
installations now write a version1 resource-settlement lease before launching
work. This is internal coordination metadata, with no new public option,
namespace, PID scan or cleanup authority.

The lease contains its exact resourceId and resourceSettlementVersion1. It is
synced before admission returns. Existing ordinary process-reader records retain
their original semantics; their strict schema is not widened. The resource owner
is recognized separately, and unknown future metadata remains protected.

Parent exit cannot prove that an external child or disposal operation settled.
The exit hook preserves resource leases, and dead-parent recovery cannot reap
them. Diagnosis reports resource-settlement-unconfirmed. Only the existing exact
scoped release capability removes the fence after the resource owner confirms
closure. A rejected/unknown close, lost parent or unreadable/partial record stays
protected. Missing automatic recovery is deliberate: elapsed time, a dead PID or
an install ID alone does not constitute external-resource settlement.
The exact session receipt requires matching resourceId, settled:true and
pending:false. An omitted or null pending flag cannot release its fence.

This repairs the pending-parent durability gap when a bounded subprocess timeout
returns and the initiating CLI exits. It does not turn direct-child close into a
complete arbitrary-descendant census. Actual execution owners still must prove
their own descendant/native/stream closure; no new such qualification is claimed.
Resource sessions that never explicitly settle remain visible protected evidence
for their actual recovery owner. The implementation and fresh-process/lease
regression sources remain UNVALIDATED until the deferred Windows batch runs.

Sessions also pin applicable ancestor category roots explicitly supplied by the
launch authority. A live child profile/run therefore blocks whole-category
migration, and a category exclusion rejects newly starting child sessions. This
reuses the exact-root lock handshake; it does not scan or authorize arbitrary
parents or introduce a hierarchy registry. Physical managed installs already pin
their tooling category as well as the selected physical owner.
