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
- `docs/specs/graph-product-surfaces.md`

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
- `--edgeTypes call,usage,import` (filter edge types)

Witness path edges always contain typed node references (`type` plus the node's
identity), including resolved symbol-reference endpoints. Top-level symbol edges
retain their reference envelopes. Incoming/both-direction symbol traversal visits
the source chunk while preserving the original chunk-to-symbol edge orientation.
An unresolved reference without a target remains an edge and does not invent a
witness path or node.

Edge type notes:
- `call`, `usage`, `import` apply to `graph_relations` graphs.
- When `--graphs` includes `symbolEdges`, `--edgeTypes` refers to `symbol_edges.type` values (default `symbol` when missing).

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
Return upstream/downstream/bidirectional impact radius from a seed with witness paths.

### Command
```bash
pairofcleats impact --repo . --seed symbol:<symbolId> --direction downstream --depth 2 --format json
```

### Required flags
- `--direction upstream|downstream|both`
- `--depth <n>`

### Optional flags
- `--seed <ref>`
- `--changed <file>` (repeatable)
- `--changedFile <path>` (file containing newline-separated paths)
- `--graphs callGraph,importGraph,usageGraph,symbolEdges` (filter graphs)
- `--edgeTypes call,usage,import` (filter edge types)
- `--minConfidence <0..1>` (when confidence exists)

Edge type notes:
- `call`, `usage`, `import` apply to `graph_relations` graphs.
- When `--graphs` includes `symbolEdges`, `--edgeTypes` refers to `symbol_edges.type` values (default `symbol` when missing).

If changed-set flags are used and `--seed` is absent:
- the tool SHOULD derive seeds deterministically (best-effort) and record warnings.
- if the changed set resolves to empty (no usable repo-relative paths), the tool MUST fail with `ERR_EMPTY_CHANGED_SET`.

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

### Optional flags
- `--maxBytes <n>`
- `--maxTokens <n>` (soft; deterministic estimator)
- `--includeGraph` / `--no-includeGraph`
- `--includeTypes` / `--no-includeTypes`
- `--includeRisk` / `--no-includeRisk`
- `--includeImports` / `--no-includeImports`
- `--includeUsages` / `--no-includeUsages`
- `--includeCallersCallees` / `--no-includeCallersCallees`
- `--includePaths` / `--no-includePaths`
- `--maxTypeEntries <n>`

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
pairofcleats api-contracts --repo . --onlyExports --format json
```

### Optional flags
- `--onlyExports` (boolean)
- `--failOnWarn` (boolean; non-zero exit if any warnings)
- caps:
  - `--maxSymbols <n>`
  - `--maxCallsPerSymbol <n>` (alias: `--maxCalls`)
  - `--maxWarnings <n>`
- artifact emission:
  - `--emitArtifact` (boolean; write `api_contracts.jsonl`)
  - `--artifactDir <path>` (optional target dir; defaults to the index dir)

`--maxWarnings` caps retained details, while `--failOnWarn` responds to detected
violations independently of that cap. Zero details cannot turn a known violation
into a successful validation; a clean zero-cap report still succeeds.
`--onlyExports` uses explicit JS/TS symbol export identity, including default and
aliased local exports. Internal declarations stay excluded. Missing or unknown
JS/TS identity produces `EXPORT_IDENTITY_UNAVAILABLE`; validation is incomplete
and `--failOnWarn` fails even when no warning details are retained.

Calls with explicit targets stay attached to those exact declarations. Same-name
declarations, imported spellings and caller-map buckets cannot retarget a call.
Unresolved or ambiguous lexical calls are counted separately and never treated
as definitive arity violations. The report's `callEvidence` records those counts
and calls omitted by export/symbol/call caps; unresolved details are counts only.
Observed calls retain `targetChunkUid` and a `join` record with admitted symbol
and index authority. These are recorded structural targets, not runtime dispatch
or feasibility proof.

### Output
- JSON: `ApiContractsReport` (validated)
- MD: deterministic ordering by `symbolId`:
  - per symbol: signature → observed calls → retained warnings
  - observed call labels include their recorded target/join qualification
  - a report-wide summary exposes detected, retained and omitted warning counts
    when details were dropped; legacy unknown omission counts stay unreported

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

Explicit `--test-pattern` globs can select ordinary test candidates of any
extension, including Python and Go. The existing JS/TS naming policy applies
when no explicit pattern is supplied. Selection does not prove a file is runnable,
compatible with a particular framework, or covered by the graph; discovered
files are never executed automatically.

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


Prepared graph indexes admit CSR independently per family. A family must match
normalized node IDs and have complete offsets and unique ascending edge rows.
Rejected or absent CSR is derived from ordinary graph data. Once equivalent CSR
exists, temporary ordinary outgoing rows are released; metadata and ID tables
remain available. Bounded fanout counts all qualifying candidates while creating
edge descriptors only for the admitted prefix. Reverse-CSR setup remains a
separate cold cost. Sorted edge windows merge through stable heap heads.

Suggest-tests retains one predecessor and distance per discovered node. It ranks
all lightweight matches before applying the suggestion cap, then reconstructs
witness paths only for returned graph suggestions. Matched and omitted counts
still describe the full admitted traversal. Structural tuple keys preserve literal
delimiters in edges, candidate envelopes and witness paths.


### Retained call occurrences and display evidence

`createGraphStore` exposes `readCallSitesPage` and `iterateCallSites` for the
canonical retained `call_sites` family. This route includes unresolved and
ambiguous occurrences by source file or caller; candidate targets are never
presented as definite incoming calls. The pair-evidence map used by neighborhood
displays remains a derived projection. Normal graph loading streams that map
without collecting another array of full occurrence payloads. Its existing ID
lists still scale with resolved evidence; this is not a bounded-memory graph
index qualification.

The page cursor binds the exact pieces manifest, absolute generation root,
physical ordering contract and exact filters/direction. Replacing the manifest,
changing a filter, missing a retained generation, checksum corruption or a
malformed offset table refuses continuation. Every touched piece is verified on
the same contained data/offset handles used for hydration, including same-size,
equal-timestamp edits. Page hydration is bounded to 512 rows, 4 MiB and 4,096
scanned physical rows; an empty filtered page can therefore carry a continuation.
A page too small for its next occurrence fails explicitly rather than skipping it.
Verification still reads the touched piece and validates its offset table; no
query speedup or bounded verification CPU claim is made.

The first positioned route requires published uncompressed JSONL plus registered
offsets, counts, byte lengths and SHA-1/SHA-256 checksums. Compressed and legacy
representations report `ERR_CALL_SITE_PAGING_UNAVAILABLE`; their existing explicit
compatibility loaders remain available. Cursor portability is not a retention
lease: callers must keep the existing generation reader/retention ownership alive
through enumeration. This source-only implementation has authored exact-set,
multiple-shard, repeated-edge, ambiguity/unresolved, filter mismatch, replacement,
mutation and cancellation controls; they have not been executed. Complete
producer-to-public-consumer adoption, compressed paging, durable propagation
resume and end-to-end qualification for #1348/#1484 remain open.


### Complete collected adjacency versus the graph display

The production streaming graph writer also emits `graph_relation_edges` through
its existing sorted spill/merge and sharded JSONL/offset owners. Each retained
row is a unique `{schemaVersion: 1, graph, from, to}` adjacency. Raw resolved collection now precedes
the display node cap; exact sorted comparison performs deduplication before any
display edge slots are spent. A recursive call is retained. Distinct call
occurrences and unresolved/ambiguous targets remain in `call_sites`; this compact
adjacency family does not replace occurrence multiplicity or claim complete
upstream syntax/resolution coverage.

`createGraphStore.readGraphEdgesPage` and `iterateGraphEdges` use the same pinned
page reader as call occurrences. They enumerate every retained row, including
high-degree tails outside the default graph display, with exact graph/from/to or
node/direction filters. No node acquires an unbounded neighbor-array row in this
representation. The existing capped `graph_relations` payload remains the display
projection and advertises its retained-edge scope separately. Its legacy
pre-materialized producer path has not been qualified as complete retained input.

Graph spill merges now use the existing checkpoint planner with a 32-run fan-in,
explicit comparator identities and cancellation-aware readers. Original inputs
and failed checkpoints remain candidate-owned; a failure prevents publication.
This does not yet qualify durable propagation resume or complete disk-working-set
accounting for the legacy graph spill owner. Authored controls compare all 123
unique edges across tiny shards against node/edge/display-byte caps, repeated
observations, recursion, incoming pages and cancellation. No controls have run;
public consumer adoption and end-to-end performance
and interruption acceptance remain required.


The private dispatcher bridge is
`prepareGraphEvidencePage({indexDir, graphInputs?, family, filter?, cursor?, limit?,
scanRows?, maxPageBytes?, expectedBuildId?, signal?})` in `graph-helpers.js`.
`family` is exactly `call_sites` or `graph_relation_edges`. The supplied index root
must be the same immutable root for every continuation; optional preloaded inputs
must identify that root. A nonempty manifest build ID is required and an explicit
expected ID must match. The returned envelope includes that generation, the page
scope/ordering, rows, scanned count, done state and cursor. The adapter reserves
cursor/envelope space before asking the page owner for rows and checks the entire
JSON response against its 4 KiB–4 MiB allowance. It does not load chunk metadata,
CSR, a graph index or complete occurrence arrays. Canonical public CLI/API/MCP
request/response schemas and dispatch remain separately owned integration work.

Generation/root refusal uses `ERR_RETAINED_EVIDENCE_GENERATION`; full-envelope
size refusal uses `ERR_RETAINED_EVIDENCE_RESPONSE_BYTES`. Per-family errors retain
`ERR_CALL_SITE_*` or `ERR_GRAPH_EDGE_*` codes for cursor scope, invalid retained
inventory, unavailable positioned representation and an individually unfit row.
All cursor continuations bind the exact manifest as well as build ID: matching a
build label alone cannot authorize a changed family.


## Containing-file import projection

Canonical import adjacency remains importer-file → imported-file. When a chunk
enters the import graph through its indexed containing file, a context edge may
use that chunk as the current endpoint. Such an edge and its witness carry
`importProjection`: version `1`, kind `chunk-containing-file-import`, `chunkUid`,
`containingFile`, `fromFile` and `toFile`. The last two fields retain the actual
canonical import orientation. Every canonical endpoint equal to the containing
file projects to that exact chunk; all other endpoints remain file references.
This is a containing-file alias, not evidence that a particular chunk imports a
module. It adds no traversal hop, work allowance or synthetic inverse relation.
A self-import retains its current chunk endpoint and cannot manufacture another
file node with a disconnected witness.

Ordinary output and graph-witness use the same projection. Qualification checks
it against the selected graph's chunk/file facts. The returned schema and chain
validator require the typed canonical association, including when paths are not
requested; arbitrary chunk endpoints under importGraph remain invalid. Source
extraction and runtime feasibility stay unqualified. Human output displays the
canonical file import and chunk alias explicitly. The graph-context producer is
1.1.0 and graph-impact producer is 1.2.0; the private neighborhood key is version
2. These are response producers, not a change to indexed semantic meaning.

For an imports-only CLI selection, preparation obtains the requested chunk's
file from canonical chunk metadata in that same selected generation. It attaches
only that fact to a private selected-index view. It neither rereads working-tree
source nor alters the cached graph for other queries. Conflicting graph and
chunk metadata file facts fail admission rather than silently choosing one.
## Suggestion computation time allowance

`suggest-tests --maxWallClockMs` now governs suggestion computation with one
monotonic cooperative allowance. Null/omitted means no time allowance; zero
expires at computation admission before directory or graph traversal work.
Finite non-negative numeric values are floored to milliseconds; negative,
non-finite, non-numeric and unsafe integer values fail admission. Existing count
caps remain independent and unchanged.

The allowance starts after configuration, changed-input loading and graph
artifact preparation. Those operations and output rendering/serialization are
excluded; CLI reports record excluded preparation elapsed time separately. The
accepted cap is retained in `provenance.capsUsed.suggestTests.maxWallClockMs`.
Explicit time allowances also produce a strict `execution` receipt describing
scope, monotonic elapsed time, exhausted phase, completed phases, observed work,
settlement and observed overrun. This is not a hard wall-clock guarantee: one
synchronous directory/neighbor operation or in-memory sort can overrun before
the next checkpoint. Required cleanup can also exceed the allowance.

Admission, every directory open/read and candidate, reverse-import preparation,
each seed/neighbor, selection, heuristics and witness construction share the
same owner. Expiry stops further admission and fallback, records
`maxWallClockMs` truncation and `deadline_exhausted` fidelity, and returns partial
coverage even when no suggestion was retained. It cannot become complete
no-match/no-tests evidence. A directory prefix is discarded unless enumeration
and closure finished before its admission checkpoint. Warm discovery still
revisits the bounded live inventory; expired inventories are not cached.
Development `.cache/` and `.tmp/` directories join existing discovery exclusions.

Normal returns require confirmed directory closure. A pending read forbids
close and retains its original resource observation plus the exact directory
session; failed closure retains that same handle for explicit recovery. These
failures propagate instead of falling back or claiming settlement. Recovery
closes only after original prerequisites settle and never reruns discovery.
Clock, directory and neighbor adapters are private fixture seams, not public
CLI/configuration options. Existing graph/heuristic distinctions and count-cap
coverage remain.
