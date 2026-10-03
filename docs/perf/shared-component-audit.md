# Shared Component Audit

This document is a historical shared-helper adoption note. Current roadmap status, duplicate-code policy, and shared-module checkpoint decisions live in `docs/roadmap.md`, `docs/tooling/duplication-reduction-status.md`, and `docs/tooling/shared-module-reductions/432-prioritized-implementation-backlog.md`.

Completed consolidations:
- Limits normalization (`src/shared/limits.js`) used in graph, retrieval, index, and tooling flows.
- Provenance resolution (`src/shared/provenance.js`) used in graph and context pack outputs.
- Truncation recording (`src/shared/truncation.js`) used in graph and retrieval outputs.
- Path normalization (`src/shared/path-normalize.js`) used in graph tooling, retrieval filters, and index inputs.
- Seed reference parsing (`src/shared/seed-ref.js`) used in CLI tooling.
- Duration formatting (`src/shared/time-format.js`) used in bench and service tools.
- SQLite manifest path normalization now delegates to shared path normalization helpers.
- Build scheduler core lives under `src/shared/concurrency/**` with runtime queue adapters wiring Stage1/2/4 in `src/index/build/runtime` + `src/index/build/indexer`.
- Embeddings runner now uses the shared build scheduler queues (`embeddings.compute`, `embeddings.io`) for compute + IO backpressure.

Current checkpoint:
- No open shared-component audit item is tracked here. Reopen shared-helper work only from a fresh governance failure, measured import/performance regression, future intentional duplicate-audit refresh, or a roadmap lane with live evidence.

Bench harness:
- `node tools/bench/bench-runner.js --suite sweet16-ci --json .testLogs/bench-sweet16.json --quiet`
