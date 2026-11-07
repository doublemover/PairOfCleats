# Public Artifact Surface (0.1.0)

Publication readiness binds the record's mode, build root, mode index directory,
generation identity and artifact surface version to the requested authority.
Its ordinary, contained manifest must carry the same mode/build identity. A
record copied from another root cannot authorize promotion while the old root's
manifest happens to exist. Mixed-mode pointers validate each selected published
root independently; cleanup and reader retention continue to own old generations.

This document is the **canonical** contract for PairOfCleats public artifacts. It supersedes `docs/contracts/artifact-contract.md` for all contract decisions.

## Contract version

- `artifactSurfaceVersion`: **0.1.0** (SemVer, hard-breaks only).
- **No transition paths**: if `artifactSurfaceVersion` or required schema versions do not match the accepted ranges, readers **must fail closed**.

## Manifest-first discovery (required)

- `pieces/manifest.json` is the **single source of truth** for artifact discovery.
- Readers must resolve artifacts **only** via the manifest in strict mode (default).
- Tools must not guess filenames or silently scan directories.

Strict readers reject linked path components, including junctions, and verify
that opened descriptors still identify the admitted contained ordinary files.
This applies to payloads and sidecars. Declared SHA-1, SHA-256 and xxh64 checksums
must have the exact supported encoding and match bytes; unsupported or malformed
strict checksums cannot be ignored.

Replacement sharded families use immutable generation paths and one enclosing
manifest commit. Existing readers retain their selected generation until their
normal lifetime ends. Writers and compaction do not delete old selected payloads
as part of publication. Publication records require explicit successful
validation evidence and matching mode/build-root authority, family membership
and committed piece identity. Missing evidence and unknown statuses fail closed.

Generation validation records a versioned SHA256 binding of the complete canonical
manifest and independently streamed contained piece bytes, plus the exact committed
inventory. The publication writer and promotion readiness recheck that binding;
same-size edits, replaced inventories, missing pieces and stale same-root reports
require fresh qualification. No all-generation sealed owner is currently available
at these boundaries, so a manifest digest does not waive independent content checks.
The shared index-state owner requalifies a previously valid publication around its
controlled state/manifest updates. Stage3 explicitly requalifies after successful
producer validation and its final ready-state write. Failure leaves publication
unready; mixed-mode roots retain separate bindings.

`index_state.profile` and `index_state.artifacts` are bounded schema-checked
generation policy. Presence claims, omissions and required families must agree
with the selected manifest and canonical profile requirements. Legacy absent
profile metadata uses `default`; explicit unknown/conflicting profiles fail.
Stats and shared validation derive sparse/field/phrase/chargram requirements from
this admitted policy, validate declared optional families and report current-config
drift separately as compatibility/rebuild-needed. Same-run validation additionally
compares the captured producer plan. New producers explicitly declare both
`field_postings` and `field_tokens`; older envelopes derive their paired requirement
from declared field artifacts.

## Required public artifacts

These artifacts define the public surface and must be present when referenced:

- `pieces/manifest.json`
- `index_state.json`
- `builds/current.json` (when a build is promoted)
- Sharded JSONL sidecars: `*.meta.json` for all `*.jsonl.parts/` artifacts

## Optional public artifacts (when enabled)

- `call_sites` (jsonl or sharded jsonl) when relations are enabled.
- Interprocedural risk artifacts when cross-file risk analysis is enabled:
  - `risk_interprocedural_stats`
  - `risk_summaries`
  - `risk_flows`
  - `risk_partial_flows`
- `lexicon_relation_filter_report` (json) when lexicon relation filtering is enabled for code builds.
- Embeddings and ANN artifacts (when embeddings are enabled):
  - `dense_vectors`, `dense_vectors_doc`, `dense_vectors_code`
  - `dense_vectors_hnsw` + `dense_vectors_hnsw_meta`
  - `dense_vectors_doc_hnsw` + `dense_vectors_doc_hnsw_meta`
  - `dense_vectors_code_hnsw` + `dense_vectors_code_hnsw_meta`
  - `dense_vectors_lancedb` + `dense_vectors_lancedb_meta`
  - `dense_vectors_doc_lancedb` + `dense_vectors_doc_lancedb_meta`
  - `dense_vectors_code_lancedb` + `dense_vectors_code_lancedb_meta`
  - `dense_vectors_sqlite_vec_meta` (optional sqlite-vec marker)

## Artifact format notes

- `chunk_meta` may be emitted as `chunk_meta.json`, `chunk_meta.jsonl`, sharded `chunk_meta.parts/` + `chunk_meta.meta.json`, or `chunk_meta.columnar.json`.
- `symbol_occurrences` and `symbol_edges` may be emitted as JSONL/sharded JSONL or as `*.columnar.json` when `indexing.artifacts.symbolArtifactsFormat=columnar`.
- `pieces/manifest.json` may include `format: "columnar"` for columnar artifacts; readers must treat columnar as equivalent to JSON/JSONL rows after inflation.

## Reserved / invariant fields

The following fields are reserved and must not change meaning across versions:

- `artifactSurfaceVersion`
- `schemaVersion`
- `repoId`
- `buildId`
- `compatibilityKey`
- `generatedAt`

Per-record invariants:

- `file` fields are repo-relative, normalized (posix separators), and must not contain `..`.

## Extension policy

- Many artifact schemas allow `additionalProperties`; extra fields may appear outside `extensions` unless a schema sets `additionalProperties: false`.
- Extensions remain the recommended place for namespaced vendor data (e.g., `extensions.vendorName.*`).

## Schema versioning

- All schemas use SemVer strings.
- `schemaVersion` is required for sharded JSONL meta files.
- For major `0`, readers support the current major only. For major `1+`, readers support **N-1 major**; unknown majors are **hard errors**.

## Sharded JSONL meta schema (required)

All `*.meta.json` files for `*.jsonl.parts/` artifacts must include:

- `schemaVersion` (SemVer)
- `artifact` (base name, e.g., `chunk_meta`)
- `format`: `jsonl-sharded`
- `generatedAt` (ISO-8601)
- `compression`: `none | gzip | zstd`
- `totalRecords`, `totalBytes`
- `maxPartRecords`, `maxPartBytes`, `targetMaxBytes`
- `parts`: list of `{ path, records, bytes }`

## Reference envelope (contract-first)

Reference fields must use the canonical shape:

- `ref.target`: string (stable identifier)
- `ref.kind`: string (enum per artifact)
- `ref.display`: string (human-readable)

## Truncation envelope (contract-first)

Artifacts that truncate content must include:

- `truncation.kind`: string
- `truncation.reason`: string
- `truncation.bytes`: integer (original bytes)
- `truncation.retainedBytes`: integer

## Path safety

- All manifest paths must be **relative**, **normalized**, and must not contain `..`.
- Absolute paths are invalid.

## Compatibility key

`compatibilityKey` must be computed from:

- `artifactSurfaceVersion` **major**
- schema registry hash
- `tokenizationKey`
- embeddings identity (when enabled)
- language/segment policy identity
- chunk id algorithm version
- enabled mode set

Readers must hard-fail if compatibility keys differ.

## Lexical producer evidence

Phrase and chargram per-chunk limits are shared across configured fields.
`indexing.postings.chargramMaxTokenLength` defaults to 48 when absent; explicit
`null`, `0` or `false` disables that token-length limit. Repeated normalization
retains the uncapped meaning. Independent per-chunk/unique-term guards still
apply. Rebuild affected postings after producer meaning changes; existing
artifacts cannot acquire previously omitted long-token evidence by relabelling.
Synonym expansion accepts only own string-valued synonym entries, so reserved
object-property names remain ordinary string tokens.

