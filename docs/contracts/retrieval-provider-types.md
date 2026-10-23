# Retrieval provider type boundary

Status: source declarations and authored controls **UNVALIDATED**, 2026-10-22.

ANN providers declare the existing optional AbortSignal and accept numeric arrays
or numeric typed arrays as query containers. An arbitrary ArrayLike, DataView or
BigInt vector is not a valid numeric embedding contract. Availability still
requires nonempty input and does not itself prove numeric/finite model validity.
Candidate IDs support ordinary sets/arrays and the existing bitmap membership,
cardinality and enumeration capabilities. No backend, score or filter semantics
change, and no runtime input validator is weakened by these declarations.

Sparse BM25/Tantivy results are distinct from `type: 'fts'` results. The native
FTS capability declares its optional match/variant/Boolean AST and diagnostic/
overfetch callbacks, plus required nullable execution metadata and eligibility
matcher. Null means unavailable/not supplied; it is not a positive match. The
native FTS input uses the caller's normalized set, while generic sparse and ANN
interfaces retain their supported bitmap/array capabilities. The
candidate stage forwards that matcher to ranking so native tokenizer eligibility
is not replaced with a different generic token predicate. FTS and ANN factories
reference the shared JSDoc contracts; Boolean query syntax has one leaf type
owned by the query producer. There is no new public knob or schema relaxation.

The authored focused fixture checks leaf declarations and a compile-only consumer
corpus, including expected rejection of unsupported containers/signals, incomplete
candidate capabilities, wrong callbacks, missing native eligibility, fabricated
variants and malformed Boolean nodes. It also exercises the actual FTS adapter's
callback/result handoff with an inert ranker. It has not run. This complements
the existing `retrieval/ann/provider-cancellation-health`, native FTS literal/
Boolean eligibility and retrieval parity fixtures; it does not replace them or
claim a repository-wide checked-JS migration, real backend cancellation, native
model/input qualification, numerical parity or performance acceptance.
