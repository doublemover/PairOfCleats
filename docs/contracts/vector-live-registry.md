# Vector live registry pilot

`vector-generation/live-registry.js` owns immutable exact supplied membership and
placement metadata. Logical vector IDs, source support IDs, token/span IDs and
vector roots remain distinct from numeric row and physical slot IDs. Descriptor
identity includes repository, generation, storage epoch, row map, representation,
model, codec, original-vector root, dimension, metric and normalization. Metadata
alone does not verify vector bytes: admission requires the existing pinned vector
and publication owner to verify those roots against actual artifacts.

Every candidate placement must match generation, storage epoch, codec epoch,
slot and decimal incarnation before becoming a live numeric row. Tombstones are
ineligible regardless of native candidate discovery. Incarnations use a checked
unsigned 64-bit space represented as strings. Incrementing the maximum requests
slot retirement; it never wraps. This module does not allocate/reclaim storage or
revoke readers. A new epoch is legal only when the existing owner provides isolated
storage and retains every old reader/native operation's required bytes.

The real consumer `sessions/registry-filtered.js` validates an admitted eligibility
set, rejects stale/deleted native placements, and feeds qualified row proposals
to the stored-dot exact-rescue session. Native scores are ignored. An omitted or
stale proposal cannot suppress rescue. The source index lease remains owned by
that existing session and releases exactly once on close. Constructor rejection
does not transfer the caller's lease. No native graph mutation is introduced.

`verifyVectorLayoutRewrite` checks a one-to-one logical registry rewrite into an
isolated generation, preserving source supports, token/vector identity, state,
incarnation and representation. Directed edges are resolved through each exact
placement map and compared as a logical edge bag, preserving duplicate edges.
Changed topology/content/codec is a different intervention and cannot pass the
layout-only contract. The receipt does not publish, reclaim storage or certify
ANN recall. Caller-supplied edge completeness remains an upstream obligation.

Rows are capped at 65536, supports per vector at 64, edge inventories at 262144,
and encoded admission at 8 MiB by default. Counts reject oversize inputs rather
than truncate. Byte accounting describes metadata, not native vectors, heap,
decoded graph state, old generations or scratch. Layout comparison uses bounded
full inventories; it is not a measured low-cost maintenance algorithm.

Authored regression source covers incarnation near-overflow, stale codec/storage
generation, tombstones, duplicate slot rejection, retained old metadata, exact
layout/edge preservation and the actual stored-dot rescue consumer. It has not
been run. Backend writer/publication integration, byte-qualified manifests,
health/debt measurement, isolated rebuild scheduling, local repair, replicas,
codec experiments and performance qualification remain open for #1517.
