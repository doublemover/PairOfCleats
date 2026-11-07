# Managed install input ownership

The public installer captures descriptor and approved-origin data before its
first asynchronous selection read. The selected intent is deeply frozen and
carried through admission, reuse, download, verification, receipt and selector
publication. A private in-process snapshot can be reused without recopying;
serialized objects acquire no private snapshot or release authority.

Descriptor data is bounded to 1 MiB, 200,000 nodes, depth12 and 50,000 items per
container. Origins use 64 KiB, depth1 and at most128 strings. Cycles, proxies,
accessors, functions, hidden/symbolic fields and non-JSON containers are rejected
before I/O without executing their hooks. Existing canonical descriptor/archive
validation still applies. Valid descriptor identities and persisted format1
remain unchanged; this adds no public knob, origin or compatibility fallback.

The bounded passive-JSON implementation is shared with evaluation snapshots.
The evaluation adapter keeps its error codes, limits, null-prototype outputs and
code-unit ordering. Its old duplicate copy loop is replaced, while unsupported
decorated input is explicitly refused. Normal admitted JSON keeps identical data.

Acquisition and progress results join the existing resource-observation owner
before their metadata is inspected or another phase begins. Original pending
observations retain staging and leases. Error journals can still record inert
failure diagnostics without invoking progress again. Recovery retires the
original work; it cannot continue an interrupted acquisition or publish a new
generation merely because the caller supplied a settlement-shaped object.

Archive bytes are copied into a private exact-sized buffer before hashing or
asynchronous writing. Intrinsic typed-array accessors bound the original view
without consulting replaceable length/offset fields. The copied bytes must match
the pinned source, size and digest. The existing atomic chunk writer owns their
write/close/publication, with original prerequisites rechecked at commit.
The extractor receives those same sealed bytes. The caller's mutable buffer
cannot change them while the write awaits I/O.

Seven authored, locally unrun controls exercise actual publication/storage
owners with explicit inert archives and verification: descriptor mutation during
selection and download, changed-source refusal before extraction, deterministic
borrowed-buffer mutation during I/O, passive/immutable declarations and retained
evaluation behavior, pending acquisition fields and pending progress before
acquisition. They preserve exact descriptor/source content, the prior selector
on refusal, original staging/lease retirement and download counts. They do not
qualify a vendor binary, native lifecycle, latency or a complete package closure.

## Portable Go SDK acquisition

The same bounded copy owner handles the official Go release index (at most
2 MiB) and the selected archive (its exact official byte count and SHA256).
Neither parsing nor extraction invokes a downloaded buffer's conversion or
length/offset hooks. The archive copy is hashed and passed to the original
atomic chunk writer; mutation of the borrowed storage cannot alter that write.

Index and archive results join the original observation ledger before metadata
reads. A pending index stops before transaction creation. Its outer admission
retains the actual reservations and leases through an internal action session;
that session can retire only its own metadata after the captured original
observations settle. It cannot close a response, remove a transaction or accept
a supplied settlement receipt as evidence. Branded transport, archive and SDK
transaction recoveries retain their existing closure/cleanup order. Concurrent
retirement calls share the original outer release flight.

Seven additional authored, locally unrun controls cover sealed archive/index
inputs, pending index/archive results before fields, index revocation between
fields, over-limit index rejection and exact intrinsic buffer slices. They use
actual admission, selector, transaction and writer owners with inert archives
and probes, preserving the old SDK selector and proving original lease/cleanup
retirement. Vendor execution and package/build closure qualification remain
separate.

## Original action and reservation settlement

Outer installer admission captures successful results and thrown functions or
objects before settlement. The canonical bounded observation ledger retains
original receivers, callback inspections and independent resource prerequisites.
The former single-callback wrapper could forget an inspection failure on a later
successful callback. Function failures retain their exact identity without
string conversion. Normal settlement and explicit recovery check the captured
observations around each reservation release and before lease retirement.

Internal settlement receipts carry the same observation into the original
reservation owner. That owner captures receipt and field-result observations
before reading the next field, and includes them in its existing read, exact
native-identity, unlink and coordinator-close checks. An affirmative ID/flag
projection or later plain receipt cannot erase earlier prerequisites. The ledger
adds no close/release authority. Its existing finite observer/context/inspection
bounds remain binding; original metadata failures retain their own recovery.
Failure diagnostics retain exact receipt/field/inspection objects through generic
error edges without executing receipt message getters. Persisted reservation and
installation formats, allocation limits and identity checks remain unchanged.

Ten additional authored, locally unrun controls exercise real reservation,
coordinator and outer lease owners: pending/revoked receipt fields, independent
inspection work, revocation after the actual record FileHandle closes, guarded
positive/invalid receipts, function failures, pending successful action results
and original action revocation during reservation reads. No receipt-shaped
caller input substitutes for original closure, and concurrent recovery shares
the existing release flights.

## Probe observations through publication

The shared provisioning probe retains the original subprocess result, nested
output-capture observations and thrown failures before projecting fields. Its
positive, nonzero and ordinary refusal reports carry a non-enumerable observation
and exact original cause graph. Field getters cannot erase a pending interval;
replacement callbacks cannot replace the captured receiver or function.

Pyright, native TypeScript, both API7 components, C#, ast-grep, .NET SDK and
clangd propagate those observations into their verifier reports and failures.
Multi-command verification keeps every prior probe binding before another
command, around field projection and through final reporting. A later version,
capability or architecture result cannot release an earlier resource. The
existing installation owner captures the returned report and retains the actual
generation lease/stage if an original observation is revoked during subsequent
inventory or publication. Recovery requires the original observations to settle.

Reports use the existing bounded observation ledger, not another lifetime owner.
Their resource guard and witness are non-enumerable; persisted verification DTOs,
exact settlement identities, probe commands, output limits and version/capability
criteria remain unchanged. An activation result still does not qualify a runtime.

Twenty-seven authored, locally unrun cases cover retained positive/refusal reports,
exact callback receivers, replacement resistance, nested output captures, field
failures, prior-probe revocation and actual installer publication/recovery with
the previous selector preserved. Commands and archive bytes are explicit inert
fixtures. Vendor execution and final-source runtime qualification remain pending.
