# Artifact Schemas (0.0.1) — Updated for Phases 5–7

This document is the canonical contract for on-disk index artifacts. Schema validation is enforced by `src/index/validate` against the registry in `src/contracts/schemas/artifacts.js`.

## General expectations

- Artifacts are discovered **only** via `pieces/manifest.json` (manifest-first).
- Paths are **relative** and **posix-normalized**; `..` and absolute paths are invalid.
- Unknown top-level fields are errors unless the schema allows `additionalProperties`.
- Extensions are permitted only where an `extensions` object is defined.

## Sharded JSONL meta schema

Artifacts written as `*.jsonl.parts/` must include `*.meta.json` with:
- `schemaVersion` (SemVer), `artifact` (const), `format: jsonl-sharded`, `generatedAt`, `compression`
- `totalRecords`, `totalBytes`, `maxPartRecords`, `maxPartBytes`, `targetMaxBytes`
- `parts`: `{ path, records, bytes, checksum? }[]`

Sharded meta is defined for: `chunk_meta_meta`, `file_relations_meta`, `repo_map_meta`, `graph_relations_meta`.

## Artifact registry (additions for Phase 5–7)

All artifacts below are JSON unless noted. Required fields are listed.

Existing entries remain as in the base 0.0.1 contract (chunk_meta, token_postings, filter_index, index_state, …).

### Phase 5 additions (optional unless referenced by manifest)

- `filter_index` (object): add optional `byLang` map keyed by effective language id.
  - (Phase 5 also requires chunk records to expose effective language via `metaV2.lang`.)

### Phase 6 additions

- `call_sites` (jsonl or sharded jsonl):
  - Each JSONL row is a bounded callsite evidence record.
  - Canonical spec: `docs/SPEC_risk_flows_and_call_sites_jsonl_v1_refined.md` (as updated).
- `call_sites_meta` (object):
  - Sharded JSONL meta schema (const artifact `call_sites`).

### Phase 7 additions (state signaling only; artifacts already exist)

- `index_state.embeddings` must include identity and backend availability signals when embeddings are present.

## Notes

- Schema definitions are authoritative in `src/contracts/schemas/artifacts.js`.
- `metaV2` uses the metadata schema defined in `docs/metadata-schema-v2.md` (see analysis schemas).
