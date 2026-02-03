# Failing tests (temporary)

This file tracks tests that are currently gated or flaky. Runner ids match the `tests/` relative path without `.test.js`.

Logs (tests/run.js): `.testLogs/latest` points at the most recent run directory; per-test logs are `<sanitized-id>.attempt-<n>.log` (sanitize replaces `/` with `_`).

## indexing/type-inference/providers/type-inference-lsp-enrichment
- Status: gated in script-coverage action `type-inference-lsp-enrichment-test` (`tests/tooling/script-coverage/actions/language.js`).
- First seen: 2026-01-03T00:00:00Z (approx)
- Symptom: `ERR_STREAM_DESTROYED` from `vscode-jsonrpc` while clangd LSP is writing.
- Context: occurs after clangd best-effort mode without `compile_commands.json`.
- Logs: see pattern above.
- Next steps: isolate LSP client shutdown order and ensure writer is not used after stream close.

## tooling/fixtures/fixture-parity
- Status: gated in script-coverage action `fixture-parity` (`tests/tooling/script-coverage/actions/fixtures.js`).
- First seen: 2026-01-03T00:00:00Z (approx)
- Symptom: build-index failure during the `languages` fixture; process exits with code 3221226505 (Windows crash).
- Context: occurs after worker tokenization fallback in the languages fixture while indexing code files.
- Logs: see pattern above.
- Next steps: capture crash stack with `node --trace-uncaught` and isolate worker pool/tokenization failure in language fixture.

## storage/sqlite/sqlite-build-indexes
- Status: flaky (non-gated); observed hang during stage2 build.
- First seen: 2026-01-17T00:00:00Z (approx)
- Symptom: `tests/storage/sqlite/sqlite-build-indexes.test.js` stalls with `build_state.json` showing `stage2` running and heartbeat advancing.
- Context: repro when running full `build_index.js` prior to SQLite build; stage1-only run completes quickly.
- Logs: `.testCache/sqlite-build-indexes/cache/repos/.../build_state.json`
- Next steps: keep stage1-only setup in the test; investigate stage2 stall separately if it recurs.
