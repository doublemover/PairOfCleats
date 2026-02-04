# Spec: Code Map Artifact

Status: **Normative** for map generation and tooling consumption.

## Artifact names
- `code_map.json` (primary model output)
- `code_map.meta.json` (reserved for future sharding)
- `code_map.parts/*` (reserved for future sharding)

Note: the current `report map` tooling writes a single JSON file. Sharding is reserved for
future use and should preserve the same row ordering rules.

## Schema (v1.0.0)

```ts
type CodeMapModelV1 = {
  version: "1.0.0";
  generatedAt: string; // ISO 8601
  root: { path: string; id?: string|null };
  mode?: string|null;
  options: CodeMapOptions;
  legend: CodeMapLegend;
  nodes: CodeMapFileNode[];
  edges: CodeMapEdge[];
  viewer: CodeMapViewerConfig;
  summary: CodeMapSummary;
  warnings: string[];
};

type CodeMapOptions = {
  scope: "repo" | "dir" | "file" | "member";
  focus: string | null;
  include: string[];
  onlyExported: boolean;
  collapse: "none" | "file" | "dir";
  limits: { maxFiles: number; maxMembersPerFile: number; maxEdges: number };
  topKByDegree: boolean;
};

type CodeMapLegend = {
  nodeTypes: string[];
  fileShapes: Record<string, string>;
  functionBadges: Record<string, string>;
  edgeTypes: Record<string, string>;
  edgeStyles: Record<string, { style: string; color: string }>;
};

type CodeMapFileNode = {
  id: string;      // file path
  path: string;    // repo-relative, POSIX
  name: string;    // basename
  ext: string|null;
  category: string; // source/test/config/docs/generated/dir/other
  type: "file";
  members: CodeMapMember[];
};

type CodeMapMember = {
  id: string;      // stable symbol id (chunkUid preferred)
  file: string;
  name: string;
  kind: string|null;
  type: "function" | "class" | "symbol";
  signature?: string|null;
  params?: object|null;
  returns?: object|null;
  modifiers?: object|null;
  dataflow?: object|null;
  controlFlow?: object|null;
  exported?: boolean|null;
  range: { startLine: number|null; endLine: number|null };
  port: string;      // derived id for graph rendering
  sourceRank: number;
};

type CodeMapEdge = {
  type: "import" | "call" | "usage" | "dataflow" | "export" | "alias";
  from: { file?: string|null; member?: string|null };
  to: { file?: string|null; member?: string|null };
  label?: string|null;
  meta?: object|null;
};

type CodeMapViewerConfig = {
  layout?: object;
  visuals?: object;
  controls?: object;
  openUriTemplate?: string|null;
  performance?: object|null;
};

type CodeMapSummary = {
  counts: { files: number; members: number; edges: number };
  dropped: { files: number; members: number; edges: number };
  truncated: boolean;
  limits: CodeMapOptions["limits"];
  include: string[];
  scope: string;
  focus: string|null;
  collapse: string;
  topKByDegree: boolean;
};
```

## Required invariants
- `nodes[].id` MUST equal `nodes[].path`.
- `members[].file` MUST match the parent `nodes[].path`.
- `members[].id` MUST be deterministic for the same symbol inputs (chunkUid preferred).
- If an edge references a `member`, that `member.id` MUST exist in `nodes[].members`.
- `range.startLine` and `range.endLine` MUST be 1-based if present.
- `warnings` MUST be unique strings (deduplicated).

## Determinism
Ordering MUST be stable:
1. Nodes sorted by `node.path`.
2. Members sorted by `member.name` then `member.range.startLine`.
3. Edges sorted by `type:from->to:label` string keys.

## Error behavior
- Missing inputs SHOULD emit warnings and produce a reduced map.
- Strict mode SHOULD raise an error for missing `chunkUid` when building members.
- `summary.truncated` MUST be true when limits drop any files, members, or edges.

## Compatibility
- New fields MUST be additive.
- Consumers MUST ignore unknown fields.
- Breaking schema changes MUST bump `version`.

## Example (minimal)

```json
{
  "version": "1.0.0",
  "generatedAt": "2026-02-03T00:00:00.000Z",
  "root": { "path": "/repo", "id": "repo-1" },
  "options": { "scope": "repo", "focus": null, "include": ["imports"], "onlyExported": false,
    "collapse": "none", "limits": { "maxFiles": 200, "maxMembersPerFile": 60, "maxEdges": 3000 },
    "topKByDegree": false },
  "legend": { "nodeTypes": ["file"], "fileShapes": {}, "functionBadges": {}, "edgeTypes": {}, "edgeStyles": {} },
  "nodes": [],
  "edges": [],
  "viewer": {},
  "summary": { "counts": { "files": 0, "members": 0, "edges": 0 },
    "dropped": { "files": 0, "members": 0, "edges": 0 }, "truncated": false,
    "limits": { "maxFiles": 200, "maxMembersPerFile": 60, "maxEdges": 3000 },
    "include": ["imports"], "scope": "repo", "focus": null, "collapse": "none", "topKByDegree": false },
  "warnings": []
}
```

## Related docs
- `docs/perf/map-pipeline.md`
- `docs/guides/code-maps.md`
