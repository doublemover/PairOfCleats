# Prepared Python chunks

The actual Python language adapter builds its AST or heuristic chunk projection
once and returns the same `pythonChunks` used by Python metadata matching. A
private weak receipt binds this preparation to its exact source string, AST input
and chunk array. Object spread carries that original receipt through the existing
file/segment context; a copied field description cannot reconstruct it. There is
no persistent cache, second chunk array or new configuration surface.

Dispatch reuses the prepared result, including an observed null/empty result. AST
chunks retain priority over supplied native chunks. Supplied native chunks still
precede a prepared heuristic fallback. Without an actual matching preparation,
the existing direct AST/native/heuristic route remains available. A changed source
invalidates the original AST and chunk ranges; a separately supplied new AST can
take its normal route. Full-file preparation receipts are stripped with the other
full-file caches before an embedded slice is dispatched.

Preparation is invocation scoped. Changing parser, dataflow or control-flow
options requires the normal new preparation, whose resulting AST and receipt are
distinct. There is no cross-invocation options cache to invalidate. Chunk line and
byte limits still run after dispatch, so changing those options does not reuse
an earlier limited output. This does not authenticate arbitrary legacy native
arrays, qualify in-place AST mutation, or replace parser/source admission.

Authored controls cover actual adapter preparation with AST disabled, actual
converter call counts, AST-empty/native/heuristic priority, unchanged metadata,
null preparation, stale source/replaced AST, current limits and embedded slices.
A separate actual Python AST preparation control retains interpreter shutdown.
All are **UNVALIDATED**. No Python/parser/native execution, tests, syntax, format,
bootstrap or performance measurements ran. Avoided conversion is source-level
work reduction, not a measured indexing speedup or runtime qualification.
