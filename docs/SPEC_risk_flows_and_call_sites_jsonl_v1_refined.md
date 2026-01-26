# Spec: `call_sites` and `risk_flows` artifacts (JSONL) (v1.1 refined)

## Status
* **Normative** for Phase 10 implementation.
* Uses RFC 2119 keywords (**MUST**, **SHOULD**, **MAY**) for requirements.

## 1) Goal
These artifacts provide explainable, bounded evidence for **interprocedural** (cross-chunk) risk:

* `call_sites`: sampled call-site records keyed by `callSiteId`
* `risk_flows`: interprocedural source→sink paths through the resolved call graph, with per-edge call-site references

They are designed to be:
* deterministic under caps
* small enough to load for `--explain-risk`
* joinable (strict referential integrity)



**Note:** Earlier drafts used range-derived `chunkId`. This refined spec standardizes on stable `chunkUid` (Identity Contract v1). Where useful, implementations MAY additionally include `chunkId` as a debug/backcompat field.
## 2) Artifact naming and sharding
Logical artifact names:
* `call_sites`
* `risk_flows`

Each MUST be emitted in either single-file or sharded form as described in the summaries spec (§2):
* `<name>.jsonl` (or compressed)
* or `<name>.meta.json` + `<name>.parts/…`

## 3) Common format requirements
* UTF-8
* JSON Lines
* no header row
* each line MUST be ≤ **32KB** UTF-8

If a record cannot be truncated to fit 32KB deterministically, it MUST be dropped and recorded in the stats artifact.

## 4) `call_sites` schema (normative)

### 4.1 TypeScript-like definition
```ts
type CallSitesRowV1_1 = {
  schemaVersion: 1,

  callSiteId: string,         // "sha1:<hex>"
  callerChunkUid: string,
  calleeChunkUid: string,

  file: string,               // repo-relative POSIX path (call site location)
  startLine: number,          // 1-based
  startCol: number,           // 1-based
  endLine: number,            // 1-based (best-effort; may equal startLine)
  endCol: number,             // 1-based (best-effort)

  calleeName: string,         // raw callee string from relations (pre-resolution)

  // Bounded argument summaries at the call site.
  argsSummary: string[],

  // Hash of the call expression snippet (when available), else null.
  snippetHash: string | null
};
```

### 4.2 `callSiteId` computation (required)
`callSiteId` MUST be computed as:

```
callSiteId = "sha1:" + sha1(
  file + ":" +
  startLine + ":" + startCol + ":" +
  endLine + ":" + endCol + ":" +
  calleeName
)
```

Constraints:
* `file` MUST be the repo-relative POSIX path.
* Line/col MUST be 1-based.
* `calleeName` MUST be the raw string recorded by the language relations collector (e.g., `"runQuery"` or `"db.query"`).

### 4.3 `argsSummary` normalization (required)
Rules:
* Keep at most **5** arguments.
* Each argument string MUST be:
  * trimmed
  * whitespace-collapsed (`\s+ -> " "`)
  * capped at **80** characters (truncate with `…`)

If arguments are unavailable, `argsSummary` MUST be an empty array.

### 4.4 `snippetHash` computation
Preferred computation:
1. Extract the call expression substring from the source file using language-provided offsets/locations.
2. Normalize whitespace (`\s+ -> " "`, trim).
3. `snippetHash = "sha1:" + sha1(normalized)` if non-empty, else `null`.

Fallback if extraction is not possible:
* `snippetHash = "sha1:" + sha1((calleeName + "(" + argsSummary.join(",") + ")").trim())`

This fallback ensures deterministic values without requiring full-fidelity snippet extraction on every language.

## 5) Call-site collection and sampling

### 5.1 Required source of call sites
Call sites MUST be derived from `chunk.codeRelations.callDetails` for each chunk, after cross-file linking has executed.

Implementation note (current code shape):
* JS relations: `src/lang/javascript/relations.js` populates `callDetails[]`.
* Python relations: `src/lang/python/ast-script.js` populates `call_details`.

Phase 10 MUST extend these collectors to include call-site location fields (line/col and/or offsets) so `callSiteId` is stable.

### 5.2 Location fields to add (required)
Each `callDetails` entry MUST include, when available:
* `startLine`, `startCol`, `endLine`, `endCol` (1-based)
* optionally `startOffset`, `endOffset` (0-based character offsets into the file)

If `endLine/endCol` are not available, collectors MUST set them equal to `startLine/startCol`.

### 5.3 Sampling per resolved edge (required)
`call_sites` MUST be bounded by sampling:

For each resolved call edge `(callerChunkUid, calleeChunkUid)`, keep at most:
* `caps.maxCallSitesPerEdge` call sites

Deterministic sampling order:
* Sort candidate call sites by `(file, startLine, startCol, endLine, endCol, calleeName)`.
* Take the first `maxCallSitesPerEdge`.

Only call sites for edges that appear in at least one emitted `risk_flows` row MUST be written.
(Edges never used in any emitted flow should not inflate artifacts.)

## 6) `risk_flows` schema (normative)

### 6.1 TypeScript-like definition
```ts
type RiskFlowsRowV1_1 = {
  schemaVersion: 1,

  flowId: string,               // "sha1:<hex>"

  source: FlowEndpointV1_1,
  sink: FlowEndpointV1_1,

  // Path as a sequence of chunkUids from source chunk to sink chunk.
  // Length MUST be >= 2 (interprocedural only).
  path: {
    chunkUids: string[],
    // One array per edge (chunkUids[i] -> chunkUids[i+1]).
    // Each entry is a list of callSiteIds for that edge (possibly empty).
    callSiteIdsByStep: string[][]
  },

  confidence: number,            // 0..1

  notes: {
    strictness: "conservative" | "argAware",
    sanitizerPolicy: "terminate" | "weaken",
    hopCount: number,
    sanitizerBarriersHit: number,
    capsHit: string[]            // e.g., ["maxTotalFlows","maxPathsPerPair"]
  }
};

type FlowEndpointV1_1 = {
  chunkUid: string,
  chunkId?: string | null,
  ruleId: string,
  ruleName: string,
  ruleType: "source" | "sink",
  category: string | null,
  severity: "low" | "medium" | "high" | "critical" | null,
  confidence: number | null
};
```

### 6.2 `flowId` computation (required)
`flowId` MUST be computed as:

```
flowId = "sha1:" + sha1(
  source.chunkUid + "|" + source.ruleId + "|" +
  sink.chunkUid + "|" + sink.ruleId + "|" +
  path.chunkUids.join(">")
)
```

### 6.3 Path invariants (required)
For every row:
* `path.chunkUids.length >= 2`
* `path.callSiteIdsByStep.length == path.chunkUids.length - 1`
* Every `callSiteId` referenced MUST exist in the emitted `call_sites` artifact.

## 7) Flow generation algorithm (normative)

### 7.1 Inputs
The propagation engine operates on:
* `risk_summaries` in-memory representation (built from chunks)
* resolved call graph edges derived from `chunk.codeRelations.callLinks`
* local risk signals (sources/sinks/sanitizers) from summaries
* config (`caps`, `strictness`, `sanitizerPolicy`)

### 7.2 What is a “source root”
A source root is a pair:
* `(sourceChunkId, sourceRuleId)` for each source signal in a chunk.

Roots MUST be processed in deterministic order:
1. sort by `sourceChunkId`
2. then by `sourceRuleId`

### 7.3 Which sinks are emitted
When traversal reaches a chunk that has one or more sink signals:
* Emit a flow for each `(sourceRuleId, sinkRuleId)` pair encountered, subject to caps.
* The sink chunk may be at depth 1..maxDepth.
* Flows MUST be interprocedural: do not emit flows where `sourceChunkId === sinkChunkId`.

Sinks in chunks that are not reachable under the strictness mode MUST NOT be emitted.

### 7.4 Sanitizer barriers
Define a chunk as “sanitizer-bearing” if its summary contains at least one sanitizer signal.

If `sanitizerPolicy="terminate"`:
* Traversal MUST stop expanding outgoing edges from sanitizer-bearing chunks.
* Flows MAY still be emitted for sinks in the sanitizer-bearing chunk itself (conservative assumption).

If `sanitizerPolicy="weaken"`:
* Traversal continues, but confidence is penalized (§8.2).
* `notes.sanitizerBarriersHit` MUST count how many sanitizer-bearing chunks were encountered on the path (excluding the source chunk).

### 7.5 Caps (required)
During flow enumeration the implementation MUST enforce:
* `maxDepth`
* `maxPathsPerPair`
* `maxTotalFlows`

Definitions:
* A “pair” for `maxPathsPerPair` is:
  `(sourceChunkId, sourceRuleId, sinkChunkId, sinkRuleId)`

A “distinct path” is:
* `path.chunkUids.join(">")` (exact match)

Enforcement MUST be deterministic:
* If a cap would be exceeded, additional items MUST be skipped in the same deterministic enumeration order (no randomness).

### 7.6 Deterministic enumeration order (required)
Within a BFS from a source root:
* Explore outgoing edges from a chunk in lexicographic order of `calleeChunkUid`.
* When multiple call sites exist for an edge, use the deterministic sample order in §5.3.
* When a sink-bearing chunk is reached, emit sink rules sorted by `sinkRuleId`.

This guarantees a stable ordering and cap behavior.

## 8) Strictness semantics (normative)

### 8.1 `conservative`
Edge traversal condition:
* Always traversable (subject to sanitizer policy).

### 8.2 `argAware` (stateful taint; bounded and deterministic)
`argAware` traversal MUST be stateful.

#### 8.2.1 State definition
Each BFS queue entry is:
* `(chunkUid, depth, taintSetKey)`

Where `taintSetKey` is a canonical, deterministic string encoding of a bounded identifier set.

The identifier set represents names that are considered tainted within the current chunk context:
* parameter names tainted by upstream calls
* optionally, locally-tainted variable names (`taintHints.taintedIdentifiers`)
* (optional) reserved marker `"__SOURCE__"` is allowed but not required

The set MUST be:
* de-duplicated
* sorted lexicographically
* capped at **16** identifiers (drop extras deterministically after sorting)

Canonical key:
* `taintSetKey = identifiers.join(",")`

#### 8.2.2 When an argument is “tainted”
Given a call-site `argsSummary[]`, an argument is considered tainted if either:
1. It identifier-matches any identifier in the caller’s taint set (identifier-boundary match), OR
2. It matches any configured **source rule regex** from the local risk ruleset (the same rules used by the local detector).

(2) ensures direct source expressions like `req.body.userId` can be recognized even without local assignment hints.

#### 8.2.3 Traversing an edge and deriving callee taint
For a resolved edge `(caller → callee)`, consider its sampled call sites.

The edge is traversable if **any** sampled call site yields at least one tainted argument under §8.2.2.

When traversing, the callee’s next taint set MUST be derived as:
1. Obtain the callee parameter names (from `callLink.paramNames` if available; else from `calleeChunk.docmeta.params`; else empty).
2. For each sampled call site:
   * For each argument position `i`, if `argsSummary[i]` is tainted, then taint the callee param name at `i` (if present).
3. Union all tainted callee params across sampled call sites.
4. If `callee` has `taintHints.taintedIdentifiers`, union them as well.
5. Canonicalize using §8.2.1.

If the resulting callee taint set is empty, the edge MUST NOT be traversed.

#### 8.2.4 Visited-state and cycles
Visited MUST be tracked on `(chunkUid, taintSetKey, depth)` to avoid infinite loops.

## 9) Confidence scoring (normative)

### 9.1 Base confidence
Let:
* `Cs` = source signal confidence (default 0.5 if null)
* `Ck` = sink signal confidence (default 0.5 if null)

Base:
* `Cbase = clamp01(0.1 + 0.9 * Cs * Ck)`

### 9.2 Hop decay
For hop count `h = path.chunkUids.length - 1`:
* `decay = 0.85^max(0, h-1)`

(First hop is not penalized; deeper chains decay.)

### 9.3 Sanitizer penalty (`weaken` policy only)
If `sanitizerPolicy="weaken"`:
* `penalty = 0.5^(notes.sanitizerBarriersHit)`

Else:
* `penalty = 1`

### 9.4 Final
`confidence = clamp01(Cbase * decay * penalty)`

## 10) Per-record truncation (required)
If a `risk_flows` row exceeds 32KB, apply deterministic truncation:

1. Replace each `callSiteIdsByStep[i]` with at most **1** id.
2. If still too large, drop `callSiteIdsByStep` entirely and replace with empty arrays for each step.
3. If still too large, drop the row and record in stats.

If a `call_sites` row exceeds 32KB:
1. Drop `argsSummary`.
2. If still too large, drop `snippetHash`.
3. If still too large, drop the row and record in stats.

## 11) Validation invariants (required)
The validator SHOULD check:
* `schemaVersion === 1`
* `flowId` and `callSiteId` match `^sha1:[0-9a-f]{40}$`
* `path.callSiteIdsByStep.length === path.chunkUids.length - 1`
* Every referenced `callSiteId` exists (referential integrity)
* line/col are positive integers
