# Positioned varint reader resource lifetime

Status: UNVALIDATED source and authored controls, 2026-10-22.

`readVarintDeltasAt` borrows the existing async contained-file resource owner
after its actual native FileHandle opens. It keeps the original read/stat/close
methods and receiver, preserves exact falsey/frozen read and decode failures
alongside independent close errors, and withholds decoded values until confirmed
close. Safe positioned bounds, positive short-read accumulation, exact byte count
and existing delta decoding remain unchanged. An empty slice opens no descriptor.
This adoption grants no containment authority to the existing path-only API.

Original independent native observations gate actual close even when a pending
flag is false or absent. Replacement observers cannot authorize cleanup. Failed
close exposes only the existing privately recognized `containedFileSession`;
explicit FileHandle recovery calls its captured original close and returns an
exact settlement receipt only after standard void fulfillment and confirmation
of all original work. Recovery never reads, decodes, allocates a new slice or
returns a previously withheld decoded result.

The actual per-file symbol consumer now requires original read work to be
settled before taking its existing full-artifact fallback. A genuine retained
descriptor capability propagates even if a future release might settle it;
fallback is not an implicit recovery or second reader. The same rule applies to
the consumer's file-metadata and offsets-validation catch boundaries. Ordinary
missing/invalid indexes with confirmed resource closure retain their existing
fallback behavior. No arbitrary property or cause-chain scan grants close or
file mutation authority.

The original positioned-short-read fixture retains all offset and varint
assertions. Its former fd-less synthetic varint handle is replaced by actual
disposable descriptors with canonical fd/stat/read/close methods and an inert
one-byte-read boundary. A separate actual-reader/public-consumer fixture covers
falsey/frozen errors plus close failure, successful decode plus nonvoid close,
explicit original FileHandle recovery without reread, original observer
replacement, canonical indexed rows, no full scan while retained and ordinary
malformed-varint fallback. No executable validation has run.

This does not adopt every raw offset reader, multi-descriptor row session or
stream/compression owner. Their independent close failures, category/index leases
and cross-process lifetimes remain separate work. No native/platform, full-index,
performance or completed-issue acceptance is claimed.
