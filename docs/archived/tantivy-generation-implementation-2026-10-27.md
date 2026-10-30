# Tantivy generation implementation — 2026-10-27

**UNVALIDATED implementation:** source `1cd9c62e6861003eb7f8175bcf00508cf817b259`,
tree `a172625fbac96850a6330b005a54d8f5fa46c069`, branch
`codex/pr557-audit-repairs-20261012`; Windows x64, Node 26.12.1.
This is a local implementation checkpoint, not passing runtime or hosted-CI
evidence. No optional package was installed and no dependency or native binary
was changed. Functional execution remains deferred for the implementation wave.

## Delivered source

- Schema-2 receipts bind repository and selected source directory, exact manifest
  bytes, ordered document identities, materialized postings/lengths/counts,
  versioned input/adapter policy and bounded payload SHA-256 inventory.
- Builders validate source cardinalities and posting domains, hold existing
  canonical source/destination storage leases, serialize per-destination writers,
  and materialize into unique UUID directories. Completed identical builds reuse
  the verified receipt under the writer lock. The process admits at most 16 build
  operations, retaining unresolved ownership against that bound.
- One durable atomic receipt switch activates the completed immutable payload.
  Failed/partial/cancelled builds preserve earlier served bytes. Unreferenced and
  earlier generations remain retained, without invented deletion authority.
- Attachment rejects wrong source/mapping/postings, legacy/incompatible receipts
  and changed payload bytes. Explicit selected-root auto-build and cancellation
  remain. Launch environment/configuration are internal non-enumerable authority.
- Native readers capture physical close before querying, enforce a bounded
  handle cache, and hold canonical storage protection through closure. Invalid
  ordinals and unsupported asynchronous ranked responses fail. Actual asynchronous
  work drains before close; unknown work and unsuccessful close retain ownership.
- Explicit disposal can continue after an original query settles or metadata
  release is repaired. A physical close is invoked once, including on failure.
  Search-mode finalization joins sibling modes, disposes handles and retains
  primary and cleanup failures. Tool finalization preserves original errors and
  avoids forced process termination of pending native work.

## Authored coverage and static observations

Authored, not executed: 12 `storage/tantivy/generation-publication` cases and nine
`retrieval/providers/tantivy-reader-lifetime` cases. These invoke real application
orchestration with explicit deterministic builders/adapters; they do not prove a
native Tantivy implementation. Cases cover equal-count swapped mappings, changed
postings/manifests/repositories/payloads, legacy metadata, private-stage and atomic
activation failures, cancellation, concurrent same-source builds, source leases,
mutated builder input, original close, module close, pending/failed closure,
pending/asynchronous search, missing close, ordinal bounds and error composition.

The existing selected-source fixture now uses a complete published fixture
receipt as its positive control. The former schema-1 count-only positive no
longer qualifies the stricter schema-2 contract. Boolean/failure, filtered-recall
and provider-runtime fixtures retain their assertions and explicitly supply the
required close operation. The runtime matrix adds one physical-close assertion.

Completed static observations: ESLint format, JavaScript syntax checks,
configuration budget, generated script inventory refresh, whitespace checks and
shared-module cycle analysis (zero cycles). No functional fixture, optional-native
smoke or publication front gate was run for this source. Current-source affected
checks, controlled prior-owner regressions and the complete front gate remain.

## Remaining issue acceptance

#1627 remains open. The optional `tantivy` package is absent from the installation
and lockfile. A supported adapter must demonstrate settled build completion,
stored schema/row/ordinal invariants, rebuild/readback/search parity and original
reader disposal. Input and payload-byte validation do not prove those properties.
Custom/external registration and eligible generation cleanup remain shared #1574
work; this owner does not authorize deleting retained generations. Real native
execution, other-platform/performance/release qualification remain separate.
No GUI, WSL, elevation, security setting, physical link or user-cache cleanup was
used. The active roadmap remains the sole execution/status owner.
