# Phase 2 Plan (Artifact Contracts + Validation Gates)

Intent: implement Phase 2 with hard breaks and a strict contract layer so artifact discovery, schemas, validation, promotion, and compatibility are manifest-driven and fail-closed.

## Decisions (locked)
- artifactSurfaceVersion: `0.0.1` (hard break; no transition path).
- Strict validation is the default behavior (manifest required, fail closed).
- compatibilityKey inputs:
  - artifactSurfaceVersion major
  - schema registry hash
  - tokenizationKey
  - embeddings identity (when enabled)
  - language/segment policy identity
  - enabled mode set

## Action items
[x] Review existing contract docs and artifact IO behavior vs Phase 2 requirements.
[x] Author `docs/contracts/public-artifact-surface.md` for 0.0.1 and add contract presence tests.
[x] Implement manifest-first artifact discovery in `src/shared/artifact-io.js` and update tooling/tests to use it.
[x] Standardize sharded JSONL meta schema + typed-array-safe sharded JSONL writing; enforce meta↔manifest consistency.
[x] Create contracts registry + validators + adapters, tighten schemas, fix config validation edge case, and remove CLI schema drift.
[x] Implement strict validation gate + promotion barrier + path safety; add compatibilityKey emission/enforcement and query-cache signature fixes.
[x] Add golden fixtures + loader matrix suite; wire strict validation into CI.

## Notes
- No transition path: existing artifacts that do not meet 0.0.1 requirements should fail validation.
- Checkboxes in `GIGAROADMAP.md` update only at commit time; test checkboxes only after passing tests.
- Manifest-driven presence checks now flow through `resolveArtifactPresence` in `src/shared/artifact-io.js`.
- Sharded JSONL meta now emits `schemaVersion`, `artifact`, `format=jsonl-sharded`, and `{path,records,bytes}` parts with byte-accurate totals.
- Completed Phase 2.4: moved schema defs into `src/contracts/schemas/artifacts.js`, added registry/validators/adapters, tightened schemas, fixed config object validation, and removed CLI schema drift.
- CompatibilityKey now derives from manifest-aware tokenization keys, is enforced across loaders/assemble, and query-cache signatures include sharded `chunk_meta`.
- Added golden contract fixture (`tests/fixtures/public-surface`) + strict validation suite, plus loader matrix parity coverage for chunk_meta formats.
- Fixed records index_state emission and pieces_manifest schema to include checksum/stat error fields used by emitters.
- 2026-01-24: remaining failures still tracked in `failing_tests_list.md`; `mcp-schema` and `compact-pieces` remain unresolved.

## Findings (review)
- Schema sources are duplicated: `src/index/build/artifacts/schema.js` (field lists) and `src/shared/artifact-schemas.js` (Ajv validators), creating likely drift.
- `src/shared/artifact-io.js` does not reference `pieces/manifest.json` at all; it uses filename heuristics + precedence.
- `src/index/validate.js` resolves artifacts by direct file presence (no manifest), so strict validation will need a new manifest-driven path.
- Current artifact schemas allow `additionalProperties: true` broadly; Phase 2 will need tightened policies + extension namespaces.
