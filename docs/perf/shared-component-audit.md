# Shared Component Audit

This document tracks shared helper adoption and remaining audit work for duplicate utilities.

Completed consolidations:
- Limits normalization (`src/shared/limits.js`) used in graph, retrieval, index, and tooling flows.
- Provenance resolution (`src/shared/provenance.js`) used in graph and context pack outputs.
- Truncation recording (`src/shared/truncation.js`) used in graph and retrieval outputs.
- Path normalization (`src/shared/path-normalize.js`) used in graph tooling, retrieval filters, and index inputs.
- Seed reference parsing (`src/shared/seed-ref.js`) used in CLI tooling.
- Duration formatting (`src/shared/time-format.js`) used in bench and service tools.
- SQLite manifest path normalization now delegates to shared path normalization helpers.

Open audit items:
- Stage management, ANN, embeddings, benchmarking, and test runner utilities reviewed for duplicate helpers.
- Remaining audit: look for any new one-off normalization/truncation helpers added in future changes.
