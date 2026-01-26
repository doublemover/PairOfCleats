# Spec: `risk_summaries` artifact (JSONL) (v1.1 refined)

## Status
* **Normative** for Phase 10 implementation.
* Uses RFC 2119 keywords (**MUST**, **SHOULD**, **MAY**) for requirements.

## 1) Goal
Provide a **per-symbol** risk/taint summary that is:

* derived from **local** risk signals (`chunk.docmeta.risk`)
* stable, bounded, and deterministic
* suitable as input to interprocedural propagation
* small enough to avoid bloating `chunk_meta`

This artifact is intentionally "summary-level": it does **not** attempt to encode full dataflow graphs.

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

The meta sidecar MUST follow the same shape used by existing sharded JSONL artifacts (e.g., `chunk_meta.meta.json`, `graph_relations.meta.json`):
* `format: "jsonl"`
* `shardSize` (bytes)
* `partsDir`, `partPrefix`, `parts[]`, `counts[]`
* `totalEntries`, `totalBytes`
* `schemaVersion` (for the rows, i.e., this spec's versioning)

## 3) Identity model
Each row is keyed by `chunkUid` (Identity Contract v1):

* `chunkUid` MUST match the chunk's `chunkUid` (and `chunk.metaV2.chunkUid` if mirrored).
* `chunkUid` MAY be included as an optional debug/backcompat field (range-derived; not stable under edits).

Normative constraints:
* There MUST be at most one row per `chunkUid`.
* `file` MUST be a repo-relative POSIX path (forward slashes), matching the chunk's `file`.

## 4) File format requirements
* Encoding: UTF-8
* Format: JSON Lines (**one JSON object per line**)
* No header row
* Each JSON line MUST be ≤ **32KB** UTF-8 (hard limit for v1.1)

If a record cannot be truncated to fit 32KB using §9, it MUST be dropped and recorded in the stats artifact as `droppedRecords`.

## 5) Which chunks produce rows
A row MUST be emitted for each chunk that satisfies all of:
1. `chunk.metaV2.chunkUid` (or `chunk.chunkUid`) exists
2. `chunk.docmeta.risk` exists (local risk signals present)
3. `chunk.name` is a non-empty string **OR** `chunk.kind` is `"module"` (to allow module-level analysis when present)

Rationale: The interprocedural pipeline operates over callable-like symbols. Anonymous fragments are not resolvable call targets and are usually low value for cross-chunk propagation.

## 6) Row schema (normative)

### 6.1 TypeScript-like definition
```ts
type RiskSummariesRowV1_1 = {
  schemaVersion: 1,

  chunkUid: string,
  chunkId?: string | null,
  file: string,

  symbol: {
    name: string,
    kind: string,            // e.g., function|method|class|module|...
    language?: string | null // language id if available
  },

  // Local risk signals, derived from chunk.docmeta.risk.{sources,sinks,sanitizers}
  sources: RiskSignalV1_1[],
  sinks: RiskSignalV1_1[],
  sanitizers: RiskSignalV1_1[],

  // Local source→sink flows detected within the chunk (summary only).
  localFlows: {
    count: number,
    // True if at least one local flow exists
    hasAny: boolean,
    // Distinct ruleId pairs, capped and sorted deterministically
    rulePairs: { sourceRuleId: string, sinkRuleId: string }[]
  },

  // Optional: used only when strictness=argAware (see config spec).
  // If present, it MUST be bounded and deterministic.
  taintHints?: {
    taintedIdentifiers: string[] // identifiers tainted via local source assignments; no excerpts
  },

  // Bounds + truncation signals
  limits: {
    evidencePerSignal: number,    // default 3
    maxSignalsPerKind: number,    // default 50
    truncated: boolean,
    droppedFields: string[]
  }
};

type RiskSignalV1_1 = {
  ruleId: string,
  ruleName: string,
  ruleType: "source" | "sink" | "sanitizer",
  category: string | null,        // risk rule category (e.g., input, sql, command, ...)
  severity: "low" | "medium" | "high" | "critical" | null,
  confidence: number | null,
  tags: string[],
  evidence: EvidenceV1_1[]
};

type EvidenceV1_1 = {
  file: string,
  line: number,                  // 1-based
  column: number,                // 1-based
  snippetHash: string | null      // "sha1:<hex>" or null
};
```

### 6.2 Required fields
A row MUST include:
* `schemaVersion`
* `chunkUid`
* `file`
* `symbol.name`
* `symbol.kind`
* `sources`, `sinks`, `sanitizers` (MAY be empty arrays)
* `localFlows`
* `limits`

## 7) Evidence hashing (`snippetHash`)
The risk detector stores `excerpt` strings in local evidence. This artifact MUST NOT store excerpts.

Instead, evidence items MUST include `snippetHash` computed as:

1. Let `raw` be the excerpt string if available, else `""`.
2. Normalize: `normalized = raw.replace(/\s+/g, " ").trim()`.
3. If `normalized === ""`, `snippetHash = null`.
4. Else `snippetHash = "sha1:" + sha1(normalized)`.

The implementation MUST use the same SHA-1 routine used elsewhere in the toolchain (`src/shared/hash.js`) to avoid inconsistencies.

## 8) Derivation rules (from existing PairOfCleats data)

### 8.1 Sources / sinks / sanitizers
For a given `chunk`:
* `sources` MUST be derived from `chunk.docmeta.risk.sources`
* `sinks` MUST be derived from `chunk.docmeta.risk.sinks`
* `sanitizers` MUST be derived from `chunk.docmeta.risk.sanitizers`

For each entry:
* `ruleId` := `entry.ruleId || entry.id`
* `ruleName` := `entry.name`
* `ruleType` := `entry.ruleType`
* `category` := `entry.category || null`
* `severity` := `entry.severity || null`
* `confidence` := `entry.confidence || null`
* `tags` := `entry.tags || []`
* Evidence items MUST be converted to `EvidenceV1_1` and include `file` (the chunk file).

### 8.2 Local flow summary
`chunk.docmeta.risk.flows` is a list of local source→sink flow hints.

`localFlows` MUST be computed as:
* `count` := number of local flow entries
* `hasAny` := `count > 0`
* `rulePairs` := distinct `{sourceRuleId, sinkRuleId}` pairs inferred from `flow.ruleIds` when present, capped at 50 pairs.

Deterministic ordering:
* Sort `rulePairs` by `(sourceRuleId, sinkRuleId)`.

### 8.3 Optional taint hints (for `strictness="argAware"`)
If the implementation supports `strictness="argAware"` (see config + flows specs), it SHOULD populate:

* `taintHints.taintedIdentifiers`

These hints improve recall for cases where tainted values are first assigned to variables (e.g., `const id = req.body.id; runQuery(id)`), because call-site args often reference the variable name rather than the original source expression.

Definition:
* Identifiers that became tainted by local assignment from a local source (i.e., variables tracked as tainted by the same mechanism used to produce local flows).

Constraints:
* MUST be de-duplicated.
* MUST be sorted lexicographically.
* MUST be capped at 50 identifiers.

Important: `argAware` MUST still function without these hints by recognizing **direct** source expressions via the configured source-rule regexes (see flows spec). If `taintHints` are omitted, the stats artifact SHOULD record a note that variable-assignment taint hints were unavailable (degraded precision/recall).
## 9) Determinism and bounding rules

### 9.1 Sorting and caps (required)
For each signal list (`sources`, `sinks`, `sanitizers`):
1. Sort by `(ruleId, minEvidenceLocation)` where `minEvidenceLocation` is the earliest `(file,line,column)`.
2. Take at most `maxSignalsPerKind` (default 50).

For each signal's evidence list:
1. Sort by `(file,line,column)`.
2. Take at most `evidencePerSignal` (default 3).

### 9.2 Per-record 32KB truncation (required and deterministic)
If `Buffer.byteLength(JSON.stringify(row), "utf8") > 32768`, apply the following deterministic truncation steps in order until within limit:

1. **Drop per-signal `tags` arrays** (set to `[]` for all signals).
2. Reduce `evidence` arrays to **1 item** per signal.
3. Truncate `sources`, `sinks`, `sanitizers` to **at most 10** each.
4. Drop `taintHints` entirely (if present).
5. Truncate `localFlows.rulePairs` to **at most 10**.

If the row still exceeds 32KB after step 5:
* The row MUST be dropped.
* `limits.truncated` MUST be `true` and `limits.droppedFields` MUST reflect the steps attempted.
* The drop MUST be recorded in the stats artifact (`droppedRecords` with reason `"recordTooLarge"`).

## 10) Inline compact summary (in chunk meta)
In addition to the JSONL artifact, each chunk with local risk MUST receive a compact summary:

* `chunk.docmeta.risk.summary` (and therefore `chunk.metaV2.risk.summary` after metaV2 rebuild)

### 10.1 Compact summary schema (normative, small)
```ts
type RiskCompactSummaryV1_1 = {
  schemaVersion: 1,
  sources: { count: number, topCategories: string[] },
  sinks: { count: number, maxSeverity: string | null, topCategories: string[] },
  sanitizers: { count: number },
  localFlows: { count: number },
  // Optional: summary of interprocedural status (not flows)
  interprocedural?: { enabled: boolean, summaryOnly: boolean }
};
```

Constraints:
* MUST NOT include excerpts or evidence arrays.
* `topCategories` MUST be the most frequent categories, ties broken lexicographically, capped at 3.

Rationale: this is intended for retrieval/UI and must remain compact.

## 11) Validation invariants (required)
The build validator SHOULD check:
* `schemaVersion === 1`
* `chunkUid` uniqueness
* `file` is non-empty
* evidence `line` and `column` are positive integers
* `snippetHash` matches `^sha1:[0-9a-f]{40}$` when not null
