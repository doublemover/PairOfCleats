# Spec: VFS manifest artifact (v1)

Status: Informative for Phase 5, expected by Phase 8 tooling work.

Goal: provide a compact, deterministic mapping from container files to per-segment “virtual documents”, so tooling and analysis can operate on embedded languages without re-parsing container files repeatedly.

This spec aligns with:
- `docs/spec_phase8_tooling_vfs_and_segment_routing_refined.md`
- Phase 5 container vs effective language identity

## Artifact name and format

Logical name: `vfs_manifest`

Emission forms:
- `vfs_manifest.jsonl` (or compressed)
- OR `vfs_manifest.meta.json` + `vfs_manifest.parts/...` (preferred for large repos)

Manifest inventory:
- the artifact and its meta/parts must be listed in `pieces/manifest.json`.

## Row schema (v1.0.0)

Each JSONL row:

```ts
type VfsManifestRowV1 = {
  schemaVersion: "1.0.0";

  // Virtual doc identity
  virtualPath: string;       // e.g., ".poc-vfs/docs/guide.md#md:fence:3.ts"
  docHash: string;           // e.g., "xxh64:<hex16>"

  // Container identity
  containerPath: string;     // repo-relative POSIX
  containerExt: string|null; // ".md", ".vue", ...
  containerLanguageId: string|null;

  // Effective identity
  languageId: string;        // effective language registry id (e.g., "typescript")
  effectiveExt: string;      // ".ts", ".tsx", ".js", ".jsx", ...
  segmentId: string|null;

  // Segment mapping (container offsets)
  segmentStart: number;      // UTF-16 offset in container
  segmentEnd: number;        // UTF-16 offset in container

  // Optional convenience for offset mapping
  lineStart: number|null;    // 1-based line where segment starts in container
  lineEnd: number|null;      // 1-based line where segment ends in container

  extensions?: object;
};
```

## Determinism requirements

- `virtualPath` must be deterministic and must follow the canonical pattern:
  `.poc-vfs/<containerPath>#<segmentId><effectiveExt>`
- `docHash` must be computed over the virtual document text (segment text for segmented docs, full text for container docs).
- Rows must be emitted in deterministic order:
  by `containerPath`, then `segmentStart`, then `segmentId`, then `effectiveExt`.

## Producers

- Primary producer is the index builder once Phase 5 provides:
  - segment boundaries (`segmentStart/segmentEnd`)
  - effective language identity (`languageId/effectiveExt`)

## Consumers

- Tooling VFS (Phase 8) and any segment-aware analyzers that need stable virtual paths.

## Size and limits

- No row should exceed 32KB (same practical limit as other JSONL artifacts).
- `extensions` is the only permitted location for producer-specific extra fields when strict schema enforcement is enabled.
