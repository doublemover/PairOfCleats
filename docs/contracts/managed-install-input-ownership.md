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
