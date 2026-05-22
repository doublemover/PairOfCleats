# Index stats contract

## Status

- **Spec version:** 1
- **Audience:** contributors maintaining index stats reporting.
- **Implementation status:** active / implemented.
- **Last audited:** 2026-05-21

---

## 1. Goal

Provide a deterministic, manifest-first report of index artifact sizes and counts for one repo/index root.

---

## 2. CLI contract

Preferred command:

```text
pairofcleats index stats --repo <path> [--mode <mode>] [--json] [--verify]
```

Implemented path:

- `bin/pairofcleats.js` dispatches `pairofcleats index stats` to `tools/index/stats.js`.
- `src/shared/command-registry-data.js` exposes the command as `index.stats`.
- `tools/index/stats.js` owns manifest-first aggregation, verify mode, fixed ordering, and JSON/human output.

Inputs:

- `--repo <path>` or `--index-dir <path>`
- optional `--mode code|prose|extracted-prose|records`
- `--verify` for required-artifact checks

Path semantics:

- When `--repo` is provided, the implementation must honor that explicit path as the repo root input for cache/index resolution.
- Do not silently rewrite `--repo` to a detected parent git root.

If `--mode` is omitted, report all modes in fixed order.

---

## 3. Data source rules

1. `pieces/manifest.json` is source of truth for file inventory.
2. Counts/bytes from manifest entries are preferred over filesystem rescans.
3. Legacy fallback only when manifest is missing and strict mode disabled.

---

## 4. JSON output schema (v1)

Top-level:

- `schemaVersion`
- `repoId`
- `buildId`
- `indexRoot`
- `modes`
- `totals`
- `verify` (when enabled)

Per-mode fields:

- `chunkMeta` (`rows`, `parts`, `bytes`)
- `tokenPostings` (`rows`, `parts`, `bytes`)
- `phraseNgrams` (`rows`, `bytes`)
- `chargramPostings` (`rows`, `bytes`)
- `symbols` (`rows`, `bytes`)
- `symbolOccurrences` (`rows`, `bytes`)
- `symbolEdges` (`rows`, `bytes`)
- `graphRelations` (`rows`, `bytes`)
- `callSites` (`rows`, `bytes`)
- `embeddings`:
  - `denseVectors`
  - `hnsw`
  - `lancedb`

---

## 5. Verify mode

`--verify` checks:

1. required artifact presence per selected mode,
2. bytes/checksum match manifest entries when checksum exists,
3. invalid/missing artifacts are returned as warnings/errors.

No destructive behavior.

Exit behavior:

- exit `0` when no verify errors are found,
- exit `1` when verify errors are present.

---

## 6. Determinism

1. Mode ordering is fixed (`code`, `prose`, `extracted-prose`, `records`).
2. Artifact family ordering is fixed in JSON output.
3. Human text output uses the same ordering.

---

## 7. Touchpoints

- `bin/pairofcleats.js`
- `src/shared/command-registry-data.js`
- `tools/index/stats.js`
- `tools/shared/dict-utils.js`
- `src/shared/artifact-io/manifest.js`
- `src/integrations/core/status.js`

---

## 8. Contract coverage

- `tests/tooling/index-stats/contract-matrix.test.js`
