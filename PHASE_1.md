# Phase 1 Plan (P0 Correctness Hotfixes)

Intent: review Phase 1 in `GIGAROADMAP.md` for improvements, then implement all items with hard-stop queue semantics, doc-missing as a hard error, and safe log ring buffering.

## Decisions (locked)
- Queue failures: hard stop (fail-fast + cancel/stop enqueueing) and propagate errors deterministically.
- Doc-only semantics: missing doc embedding is a hard error (no zero-vector fallback).
- Log ring buffer: store a truncated JSON snapshot (8 KB per event).

## Findings (review)
- `src/shared/concurrency.js`: `runWithQueue()` swallows queue errors, uses `Promise.race(pending)` (rejects can break backpressure), and attaches no rejection handlers until later.
- `src/index/build/imports.js`: `ensureEsModuleLexer()` never invokes init, options are nested under `options` key, regex fallback is gated on lexer success, and module maps use `{}` (proto pollution risk).
- `src/shared/progress.js`: ring buffer stores raw meta (can retain circular/large objects) and `showProgress()` divides by zero when `total===0`.
- Embedding/vector handling: multiple `Array.isArray` checks in postings step and embeddings code should accept TypedArrays via shared predicate.

## Action items
[x] Review Phase 1 sections and code to identify improvements and risks (findings above).
[x] Implement 1.1 concurrency semantics in `src/shared/concurrency.js`, plus tests for error propagation, backpressure, and iterable inputs.
[x] Implement 1.2 embeddings fixes (merge semantics, TypedArray acceptance, batcher reentrancy) with new tests and run embedding batch/cache tests.
[x] Implement 1.3 postings-state fixes (chargrams, tokenless chunks, guard behavior) with new tests.
[x] Implement 1.4 dense postings doc-only semantics + TypedArray support with new tests.
[x] Implement 1.5 import scanning fixes (lexer init, options forwarding, regex fallback, proto-safe accumulators) with new tests.
[x] Implement 1.6 progress/logging fixes (pino@10 transport, redaction, ring buffer snapshotting, zero-total guard) with new tests.
[ ] Run targeted tests and `npm run test:pr` when Phase 1 changes are complete. (Targeted tests done; test:pr pending.)
