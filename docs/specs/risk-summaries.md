# Spec: `risk_summaries` artifact (JSONL) and compact summary (v1.1 refined)

## Status
* **Normative** for Phase 10 implementation.
* Uses RFC 2119 keywords (**MUST**, **SHOULD**, **MAY**) for requirements.

## 1) Goal
Provide a **per-symbol** risk summary that is:

* derived from **local** risk signals (`chunk.docmeta.risk`)
* stable, bounded, and deterministic
* suitable as input to interprocedural propagation
* small enough to avoid bloating `chunk_meta`

This artifact is intentionally summary-level: it does **not** attempt to encode full dataflow graphs.

## 2) Artifact naming and sharding
The logical artifact name is `risk_summaries`.

An implementation MUST emit either:

### 2.1 Single-file form
* `risk_summaries.jsonl` (or `risk_summaries.jsonl.gz` / `risk_summaries.jsonl.zst` if compression is enabled)

### 2.2 Sharded form (recommended for large repos)
* `risk_summaries.meta.json`
* `risk_summaries.parts/`
  * `risk_summaries.part00000.jsonl` (or `.jsonl.gz` / `.jsonl.zst`)
  * `risk_summaries.part00001.jsonl`
  * ...

The meta sidecar MUST follow the JSONL sharded meta schema:
* `schemaVersion` (SemVer), `artifact` (const), `format: "jsonl-sharded"`, `generatedAt`, `compression`
* `totalRecords`, `totalBytes`, `maxPartRecords`, `maxPartBytes`, `targetMaxBytes`
* `parts`: `{ path, records, bytes, checksum? }[]`

## 3) Identity model
Each row is keyed by `chunkUid` (Identity Contract v1):

* `chunkUid` MUST match the chunk's `chunkUid` (and `chunk.metaV2.chunkUid` if mirrored).
* There MUST be at most one row per `chunkUid`.
* `file` MUST be a repo-relative POSIX path (forward slashes), matching the chunk's `file`.

## 4) File format requirements
* Encoding: UTF-8
* Format: JSON Lines (**one JSON object per line**)
* No header row
* Each JSON line MUST be <= **32KB** UTF-8 (hard limit for v1.1)

If a record cannot be truncated to fit 32KB using Section 9, it MUST be dropped. Dropped rows are recorded
in `risk_interprocedural_stats.droppedRecords` (artifact `risk_summaries`) when interprocedural stats are written.

## 5) Which chunks produce rows
A row MUST be emitted for each chunk that satisfies all of:
1. `chunk.metaV2.chunkUid` (or `chunk.chunkUid`) exists
2. `chunk.docmeta.risk` exists (local risk signals present)

## 6) Row schema (normative)

### 6.1 TypeScript-like definition
```ts
type RiskSummaryRowV1 = {
  schemaVersion: 1,

  // identity
  chunkUid: string,
  file: string,
  languageId: string | null,

  // optional symbol context (must not bloat)
  symbol: {
    name: string | null,
    kind: string | null,
    signature: string | null
  },

  // signals (bounded + deterministic)
  signals: {
    sources: RiskSignalSummary[],
    sinks: RiskSignalSummary[],
    sanitizers: RiskSignalSummary[],
    localFlows: RiskLocalFlowSummary[]
  },

  // optional: local taint hints (helps arg-aware)
  taintHints?: {
    taintedIdentifiers: string[]
  },

  totals: {
    sources: number,
    sinks: number,
    sanitizers: number,
    localFlows: number
  },

  truncated: {
    sources: boolean,
    sinks: boolean,
    sanitizers: boolean,
    localFlows: boolean,
    evidence: boolean
  }
};

type RiskSignalSummary = {
  ruleId: string,
  ruleName: string,
  ruleType: "source" | "sink" | "sanitizer",
  category: string | null,
  severity: string | null,
  confidence: number | null,
  tags: string[],
  evidence: EvidenceRef[]
};

type RiskLocalFlowSummary = {
  sourceRuleId: string,
  sinkRuleId: string,
  category: string | null,
  severity: string | null,
  confidence: number | null,
  evidence: EvidenceRef[]
};

type EvidenceRef = {
  file: string,
  startLine: number,
  startCol: number,
  endLine: number,
  endCol: number,
  snippetHash: string | null
};
```

### 6.2 Required fields
A row MUST include:
* `schemaVersion`
* `chunkUid`
* `file`
* `signals` (sources/sinks/sanitizers/localFlows arrays MAY be empty)

The following fields SHOULD be present when available:
* `totals`
* `truncated`

## 7) Evidence hashing (`snippetHash`)
The risk detector stores `excerpt` strings in local evidence. This artifact MUST NOT store excerpts.

Evidence items MUST include `snippetHash` computed as:

1. Let `raw` be the excerpt string if available, else `""`.
2. Normalize: `normalized = raw.replace(/\s+/g, " ").trim()`.
3. If `normalized === ""`, `snippetHash = null`.
4. Else `snippetHash = "sha1:" + sha1(normalized)`.

The implementation MUST use the same SHA-1 routine used elsewhere in the toolchain (`src/shared/hash.js`).

`endLine` and `endCol` MUST be present. If end positions are not available, set them equal to `startLine` and `startCol`.

## 8) Derivation rules (from existing PairOfCleats data)

### 8.1 Sources / sinks / sanitizers
For a given `chunk`:
* `signals.sources` MUST be derived from `chunk.docmeta.risk.sources`
* `signals.sinks` MUST be derived from `chunk.docmeta.risk.sinks`
* `signals.sanitizers` MUST be derived from `chunk.docmeta.risk.sanitizers`

For each entry:
* `ruleId` := `entry.ruleId || entry.id`
* `ruleName` := `entry.name`
* `ruleType` := `entry.ruleType`
* `category` := `entry.category || null`
* `severity` := `entry.severity || null`
* `confidence` := `entry.confidence || null`
* `tags` := `entry.tags || []`
* Evidence items MUST be converted to `EvidenceRef` and include `file` (the chunk file).

### 8.2 Local flow summary
`chunk.docmeta.risk.flows` is a list of local source->sink flow hints.

`signals.localFlows` MUST be computed as:
* Each flow yields `{ sourceRuleId, sinkRuleId }` from `flow.ruleIds` when present.
* `category` and `severity` should follow the sink rule when available.
* `confidence` should derive from the source/sink confidences when available.

Deterministic ordering:
* Sort local flows by `(sourceRuleId, sinkRuleId, minEvidenceLocation)`.

### 8.3 Optional taint hints (for `strictness="argAware"`)
If the implementation supports `strictness="argAware"`, it MAY populate:

* `taintHints.taintedIdentifiers`

Constraints:
* MUST be de-duplicated.
* MUST be sorted lexicographically.
* MUST be capped at 50 identifiers.

Note: the default local risk detector does not emit taint hints today, so this field is optional and
only present when upstream tooling provides `chunk.docmeta.risk.taintHints`.

## 9) Determinism and bounding rules

### 9.1 Sorting and caps (required)
Within a row:
* Sort signals by `(ruleId, minEvidenceLocation)` (sinks may be grouped by severity first).
* Sort evidence arrays by `(file, startLine, startCol, endLine, endCol, snippetHash)`.

Caps (defaults; must be deterministic):
* `maxSignalsPerKind = 50`
* `maxEvidencePerSignal = 5`
* `maxTagsPerSignal = 10`
* `maxLocalFlows = 50`

### 9.2 Row size cap enforcement (required)
Hard limit: **<= 32KB** per JSONL row.

Deterministic trimming steps:
1. Drop `tags` arrays from all signals.
2. Reduce evidence per signal to 1.
3. Drop all evidence arrays.
4. If still too large: drop the entire summary row and record in stats (artifact `risk_summaries`, reason `rowTooLarge`).

## 10) Compact summary in chunk_meta
If and only if a chunk has local risk (any of sources/sinks/sanitizers/localFlows non-empty), attach:

```ts
chunk.docmeta.risk.summary = {
  sources: { count: number },
  sinks: { count: number, maxSeverity: string | null },
  sanitizers: { count: number },
  localFlows: { count: number },

  topCategories: string[],   // max 5
  topTags: string[],         // max 8

  interprocedural: {
    enabled: boolean,
    summaryOnly: boolean
  }
}
```

This compact summary is used for quick UI/CLI summaries without loading `risk_summaries.jsonl`.

## 11) Implementation mapping
- Builder: `src/index/risk-interprocedural/summaries.js`
- Integration: `src/index/build/indexer/steps/relations.js` (after cross-file inference)
- Meta rebuild: `src/index/build/indexer/steps/write.js`
- Writer: `src/index/build/artifacts/writers/risk-interprocedural.js`
