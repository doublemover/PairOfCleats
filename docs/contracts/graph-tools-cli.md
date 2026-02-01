# Graph tools CLI contract (Phase 11)

This document defines the CLI contracts for Phase 11 graph-powered commands:

- `pairofcleats graph-context`
- `pairofcleats impact`
- `pairofcleats context-pack`
- `pairofcleats api-contracts`
- `pairofcleats architecture-check`
- `pairofcleats suggest-tests`

All commands MUST be:
- JSON-first (schema-valid),
- bounded (caps + truncation metadata),
- deterministic (stable ordering and selection),
- and optionally render deterministic Markdown (`--format md`).

Authoritative output schemas:
- `docs/phases/phase-11/spec.md`

---

## 1) Shared conventions (normative)

### 1.1 Repo selection
All commands MUST accept:

- `--repo <path>`: repo root (defaults to current working directory)

### 1.2 Output format
All commands MUST accept:

- `--format json|md` (default `json` recommended)
- `--json` MAY be accepted as an alias for `--format json` for consistency with search.

### 1.3 Caps
All commands that traverse graphs MUST accept cap overrides. Minimum set:

- `--maxDepth <n>`
- `--maxFanoutPerNode <n>`
- `--maxNodes <n>`
- `--maxEdges <n>`
- `--maxPaths <n>`
- `--maxCandidates <n>`
- `--maxWorkUnits <n>`
- optional `--maxWallClockMs <n>` (fuse)

If caps are not provided, the command MUST use config defaults.

### 1.4 Seed format (NodeRef parsing)
All commands that require a seed MUST accept:

- `--seed <ref>`

Recommended `ref` formats:
- `chunk:<chunkUid>`
- `symbol:<symbolId>`
- `file:<path>`

If the prefix is omitted:
- the command MAY attempt deterministic inference,
- but SHOULD prefer requiring a prefix to avoid ambiguity.

### 1.5 Exit codes (recommended)
- `0`: success
- `1`: invalid request / validation error
- `2`: missing index / required artifacts missing
- `3`: internal error

In JSON mode, errors MUST be emitted as:
- `{ ok: false, code, message, errors? }`

---

## 2) `pairofcleats graph-context`

### Purpose
Return a bounded neighborhood (“graph context pack”) for a seed.

### Command
```bash
pairofcleats graph-context --repo . --seed chunk:<chunkUid> --depth 2 --direction out --format json
```

### Required flags
- `--seed <ref>`
- `--depth <n>`
- `--direction out|in|both`

### Optional flags
- `--includePaths` (boolean; default false)
- `--graphs callGraph,importGraph,usageGraph,symbolEdges` (filter graphs)
- `--minConfidence <0..1>` (when confidence exists)
- `--edgeTypes call,usage,import,export,dataflow` (filter edge types)

Edge type notes:
- `call`, `usage`, `import`, `export`, `dataflow` apply to `graph_relations` graphs.
- When `--graphs` includes `symbolEdges`, `--edgeTypes` refers to `symbol_edges.type` values.

### Output
- JSON: `GraphContextPack` (validated)
- MD: deterministic sections:
  1. Seed
  2. Nodes (distance groups)
  3. Edges
  4. Witness paths (if requested)
  5. Truncation and warnings

---

## 3) `pairofcleats impact`

### Purpose
Return upstream/downstream impact radius from a seed with witness paths.

### Command
```bash
pairofcleats impact --repo . --seed symbol:<symbolId> --direction downstream --depth 2 --format json
```

### Required flags
- `--seed <ref>`
- `--direction upstream|downstream`
- `--depth <n>`

### Optional flags
- `--changed <file>` (repeatable)
- `--changed-file <path>` (file containing newline-separated paths)
- `--graphs callGraph,importGraph,usageGraph,symbolEdges` (filter graphs)
- `--edgeTypes call,usage,import,export,dataflow` (filter edge types)
- `--minConfidence <0..1>` (when confidence exists)

Edge type notes:
- `call`, `usage`, `import`, `export`, `dataflow` apply to `graph_relations` graphs.
- When `--graphs` includes `symbolEdges`, `--edgeTypes` refers to `symbol_edges.type` values.

If changed-set flags are used and `--seed` is absent:
- the tool SHOULD derive seeds deterministically (best-effort) and record warnings.

### Output
- JSON: `GraphImpactAnalysis` (validated)
- MD: deterministic sections:
  1. Seed
  2. Impacted nodes (grouped by distance)
  3. Witness paths (one per node, bounded)
  4. Truncation and warnings

---

## 4) `pairofcleats context-pack`

### Purpose
Produce a composite pack for tooling/LLM use:
- primary excerpt + graph + types + risk (optional, bounded)

### Command
```bash
pairofcleats context-pack --repo . --seed chunk:<chunkUid> --hops 2 --maxBytes 20000 --format json
```

### Required flags
- `--seed <ref>`
- `--hops <n>`
- `--maxBytes <n>`

### Optional flags
- `--maxTokens <n>` (soft; deterministic estimator)
- `--includeGraph` / `--no-includeGraph`
- `--includeTypes` / `--no-includeTypes`
- `--includeRisk` / `--no-includeRisk`
- `--includeImports` / `--no-includeImports`
- `--includeUsages` / `--no-includeUsages`
- `--includeCallersCallees` / `--no-includeCallersCallees`
- `--maxTypeEntries <n>`
- `--riskMaxFlows <n>`
- `--riskMaxEvidencePerFlow <n>`

### Output
- JSON: `CompositeContextPack` (validated)
- MD: deterministic sections:
  1. Primary excerpt (with provenance)
  2. Graph slice (callers/callees/imports/usages)
  3. Types slice (facts)
  4. Risk slice (flows + evidence)
  5. Truncation and warnings

---

## 5) `pairofcleats api-contracts`

### Purpose
Extract cross-file API contracts for exported symbols using existing artifacts.

### Command
```bash
pairofcleats api-contracts --repo . --only-exports --format json
```

### Optional flags
- `--only-exports` (boolean)
- `--fail-on-warn` (boolean; non-zero exit if any warnings)
- caps:
  - `--maxSymbols <n>`
  - `--maxCallsPerSymbol <n>` (alias: `--maxCalls`)
  - `--maxWarnings <n>`
- artifact emission:
  - `--emitArtifact` (boolean; write `api_contracts.jsonl`)
  - `--artifactDir <path>` (optional target dir; defaults to the index dir)

### Output
- JSON: `ApiContractsReport` (validated)
- MD: deterministic ordering by `symbolId`:
  - per symbol: signature → observed calls → warnings → truncation (if any)

---

## 6) `pairofcleats architecture-check`

### Purpose
Evaluate architectural constraints over import/call graphs.

### Command
```bash
pairofcleats architecture-check --repo . --rules ./architecture.rules.json --format json
```

### Required flags
- `--rules <path>` (JSON/JSONC/YAML)

### Optional flags
- `--fail-on-violation` (boolean)
- caps:
  - `--maxViolations <n>`
  - `--maxEdgesExamined <n>`

### Output
- JSON: `ArchitectureReport` (validated)
- MD: deterministic:
  - per rule summary
  - top violations (bounded)

---

## 7) `pairofcleats suggest-tests`

### Purpose
Suggest impacted tests based on a changed file list and graph traversal.

### Command
```bash
pairofcleats suggest-tests --repo . --changed src/a.ts --changed src/b.ts --max 50 --format json
```

### Required flags
- `--changed <file>` repeatable OR `--changed-file <path>`
- `--max <n>`

### Optional flags
- `--test-pattern <glob>` repeatable (override default discovery patterns)
- shared graph caps (maxDepth/maxNodes/maxEdges/maxCandidates/maxWorkUnits)

### Output
- JSON: `SuggestTestsReport` (validated)
- MD: deterministic:
  - list of suggested tests with rationale + witness path summaries
