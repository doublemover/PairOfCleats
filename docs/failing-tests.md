# Failing tests (temporary)

This file tracks tests that are currently gated due to failures.

## type-inference-lsp-enrichment-test
- Status: gated in `tests/script-coverage.js`
- First seen: 2026-01-03
- Symptom: `ERR_STREAM_DESTROYED` from `vscode-jsonrpc` while clangd LSP is writing.
- Context: occurs after clangd best-effort mode without `compile_commands.json`.
- Logs: `tests/.logs/2026-01-03T03-19-19-760Z/type-inference-lsp-enrichment-test.attempt-3.log`
- Next steps: isolate LSP client shutdown order and ensure writer is not used after stream close.

## fixture-parity
- Status: gated in `tests/script-coverage.js`
- First seen: 2026-01-03
- Symptom: build-index failure during the `languages` fixture; process exits with code 3221226505 (Windows crash).
- Context: occurs after worker tokenization fallback in the languages fixture while indexing code files.
- Logs: `tests/.logs/2026-01-03T03-29-47-495Z/fixture-parity.attempt-1.log`
- Next steps: capture crash stack with `node --trace-uncaught` and isolate worker pool/tokenization failure in language fixture.
