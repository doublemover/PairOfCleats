# Cross-file source identity and unfinished work

The legacy cross-file propagation phase records its work through the existing required `build_state.json` owner. A `cross-file:<mode>` phase entry pins the build ID, mode, inference fingerprint, candidate count and fidelity policy. Start, completed input bundles and terminal computation are awaited writes. A required start failure prevents mutable propagation. Cancellation and failures retain an incomplete receipt, and a failure to record that receipt is attached to the original error.

`observedCompletedChunks` describes computation observed in this process. It is not a durable output cursor. Propagation mutates other target chunks, so its `durableCompletedChunks` remains zero and `resume.strategy` is `restart-phase` from durable Stage1 inputs. Computation completion does not publish artifacts: the receipt explicitly retains `publication: pending`, unsealed output and unknown overall analysis coverage. The existing full-output cache can restore a complete qualified result; it cannot resume an arbitrary mutable prefix. Fine-grained sealed propagation frontier adoption remains open.

The output-cache schema is version 5. Its fingerprint includes each chunk's source hash and hash algorithm in addition to full relation/docmeta input and producer policy identities. Type inference declines cache reuse and writes when any source input lacks a recognized byte identity. Tooling replay also remains disabled until all compiler/config/ambient dependencies have authoritative identities. Relation-only propagation can retain its existing qualified cache route.

File-relation identity failure is distinct from absent relations. Only null or
undefined represents an omitted file-relation input. A supplied Map/record whose
iteration, enumeration, payload access or canonical encoding fails propagates
the exact original error before cache lookup and mutable propagation; it cannot
borrow the absent-relations fingerprint. This also preserves private error
ownership instead of replacing a failed identity with an advisory empty value.
An identity failure occurs before a fingerprint-owned start receipt exists.
This admission does not qualify arbitrary payload sizes/depths or external
mutation during a run; broader bounded capture remains separate work.

When return inference reads source, it uses a bounded contained descriptor capture and the Stage1 encoding decoder. A known SHA1, SHA256 or xxh64 identity must match the captured bytes. A source replacement, missing pinned source, unsafe path or operational read error fails the phase; these do not become an empty clean result. Legacy unqualified inputs can still be evaluated, but their source-read coverage is explicitly unqualified and cannot authorize type-output replay. Missing unqualified sources are counted as unavailable. This is a qualification of the bytes used, not a claim of complete syntax, fixed-point analysis, graph projection or impact coverage.

Source reads are restricted to the admitted chunk inventory. Direct and `metaV2`
byte identities must agree when both exist; an incomplete direct handoff cannot
borrow its missing algorithm from another handoff to manufacture qualification.

Authored controls cover actual cold/warm output reuse, equal-layout changed source, stale producer hash, conflicting identities, missing/unsafe/denied source reads, awaited work receipts, cancellation and double-fault error ownership. They remain unrun until the requested later validation phase.
