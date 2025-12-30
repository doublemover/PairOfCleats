

# V1 Spec: Add “Triage Records + Context Packs” to PairOfCleats

## Why this exists

PairOfCleats already provides:

* fast hybrid search over **code + docs/config** with rich metadata
* a CLI (`build_index.js`, `search.js`) and an MCP server (`tools/mcp-server.js`)
* optional SQLite/FTS/ANN backends

What’s missing for your friend’s vuln triage platform use case is:

* a way to **ingest vulnerability findings** (Dependabot + AWS Inspector in v1)
* a way to **store triage history/decisions** (auditable, queryable)
* **metadata-first retrieval** (service/env/asset/team/status) rather than pure text
* a **repeatable “context pack”** builder that combines:

  * the vuln finding + environment metadata + history
  * evidence pulled from repo index (imports/usages/config/IaC/doc evidence)

This v1 adds a minimal “triage record system” that lives **in the PairOfCleats cache** (not in git), is **searchable** with filters, and produces **LLM-ready evidence bundles**.

---

## V1 Goals (must-have)

1. **Ingest findings** from:

   * Dependabot exports (JSON)
   * AWS Inspector exports (JSON)
   * plus a “generic” adapter (already-normalized JSON)
2. Normalize into a single **Record schema** with strong, filterable metadata:

   * cve/vulnId, package, version(s), service, env, asset identifiers, severity, owner/team, status
3. Persist each record in the repo cache:

   * store canonical JSON (for audits)
   * store a rendered Markdown “view” (for human readability + indexing)
4. Build a dedicated **records index** (`index-records`) and allow searching it:

   * `search.js --mode records ...`
   * support `--meta key=value` filtering (AND semantics)
5. Support **triage decision records** (history):

   * accept/defer/fix/false-positive/not-affected, with justification, reviewer, expiry
6. Generate a **context pack** per finding:

   * includes the normalized record
   * includes prior decisions (history) retrieved by similarity
   * includes repo evidence via PairOfCleats search (code/prose)
   * output JSON suitable for Bedrock/Claude prompt input

---

## V1 Non-goals (explicitly out of scope)

* Full runtime reachability / exploit path analysis
* Automatic KEV/EPSS enrichment from the internet
* Training or fine-tuning SecBERT/deBERTa/VulBERTa-style models
* A full web UI (CLI + MCP tools only)
* Building a full CMDB/inventory system (v1 assumes env metadata is supplied at ingest time)

---

# Architecture Overview

## New “Triage Records” data flow

1. User exports findings to JSON files (Dependabot / Inspector)
2. Run: `node tools/triage/ingest.js --source dependabot --in dependabot.json --repo /path/to/repo --meta service=api --meta env=prod`
3. Ingest writes:

   * `<repoCacheRoot>/triage/records/<recordId>.json` (canonical)
   * `<repoCacheRoot>/triage/records/<recordId>.md` (rendered view)
4. Build records index:

   * `node build_index.js --mode records --incremental`
5. Search records:

   * `node search.js "CVE-2024-XXXX" --mode records --meta service=api --meta env=prod --json`
6. Generate context pack:

   * `node tools/triage/context-pack.js --repo ... --record <recordId> --out context.json`

---

# Data Model

## Normalized record (JSON) — `TriageRecord`

Store in `<repoCacheRoot>/triage/records/<recordId>.json`.

Minimum top-level fields (v1):

* `recordId` (string, stable)
* `recordType` (`finding` | `decision` | `asset` | `note`)
* `source` (`dependabot` | `aws_inspector` | `generic` | `manual`)
* `createdAt`, `updatedAt` ISO timestamps
* “routing” fields (duplicated top-level for easy filtering):

  * `service` (string)
  * `env` (string)
  * `team` (string?)
  * `owner` (string?)
  * `repo` (string? repo identifier/path)
* `vuln` object (for findings):

  * `vulnId` (string: CVE-… or GHSA-… or vendor id)
  * `cve` (string|null)
  * `title` (string)
  * `description` (string)
  * `severity` (string: critical/high/medium/low/unknown)
  * `cvss` (object|null: `{ score, vector, version }` if available)
  * `cwe` (string[] optional)
  * `references` (string[] URLs)
* `package` object (for dependency findings):

  * `name`, `ecosystem` (npm/pip/maven/…)
  * `installedVersion` (string|null)
  * `affectedRange` (string|null)
  * `fixedVersion` (string|null)
  * `manifestPath` (string|null)
  * `purl` (string|null)
* `asset` object (for runtime findings):

  * `assetId` (string: ARN/image digest/instance id/etc)
  * `assetType` (string)
  * `account`, `region` (optional)
  * `tags` (object optional)
* `exposure` object (env context):

  * `internetExposed` (boolean|null)
  * `publicEndpoint` (string|null)
  * `dataSensitivity` (string|null)
  * `businessCriticality` (string|null)
  * `compensatingControls` (string[] optional)
* `decision` object (for decision records):

  * `findingRecordId` (string)
  * `status` (`fix`|`accept`|`defer`|`false_positive`|`not_affected`)
  * `justification` (string)
  * `justificationCodes` (string[]; controlled vocabulary)
  * `reviewer` (string|null)
  * `expiresAt` (ISO|null)
  * `evidenceRefs` (string[]; links or file refs)
* `raw` (object) — original raw payload (optional; can be toggled via config because it increases storage)

### RecordId generation (deterministic)

Implement `recordId = sha1(<source> + ":" + <stableFindingKey>)`, where stable key is:

* Dependabot: `alert.id` or (`GHSA` + `package` + `manifestPath`)
* Inspector: `findingArn` or (`vulnId` + `resourceId`)
* Generic/manual: caller provides `stableKey`

---

# Repo Changes (Concrete)

## 1) Config additions: `.pairofcleats.json`

Add new optional section:

```json
{
  "triage": {
    "recordsDir": "",
    "storeRawPayload": false,
    "promoteFields": ["recordType","source","recordId","service","env","team","owner","vulnId","cve","packageName","packageEcosystem","severity","status","assetId"],
    "contextPack": {
      "maxHistory": 5,
      "maxEvidencePerQuery": 5
    }
  }
}
```

Behavior:

* `triage.recordsDir` default: `<repoCacheRoot>/triage/records`
* `storeRawPayload=false` by default to avoid huge records
* `promoteFields` determines which fields get copied into `chunk.docmeta.record` (small + filterable)

## 2) Add records mode to index directories

### Update: `tools/dict-utils.js`

* Extend `getIndexDir(repoRoot, mode, userConfig)` to accept `'records'`
* Add helper:

  * `getTriageRecordsDir(repoRoot, userConfig)` → resolved records dir defaulting to cache path

(Keep backwards compatibility: existing code/prose unchanged.)

## 3) Add `records` mode to `build_index.js`

### Update: `src/indexer/build/args.js`

* Allow `--mode records`
* Keep `--mode all` behavior stable (still `code+prose` only) unless explicitly changed.

  * Recommend: `all` remains `[prose, code]` (do **not** silently include records)

### Update: `src/indexer/build/indexer.js`

* Extend `buildIndexForMode({mode,runtime})` to handle `'records'`:

  * call new function `buildRecordsIndexForRepo({ runtime })`

### New: `src/triage/index-records.js`

Implement `buildRecordsIndexForRepo({ runtime })`:

* Determine records dir via `getTriageRecordsDir`
* Discover `*.md` (rendered records) under that folder
* Build chunk(s):

  * 1 chunk per file: `start=0`, `end=text.length`, `kind='Record'`, `name=<record title or recordId>`
* Load companion JSON record:

  * same basename: `<recordId>.json`
  * extract promoted fields into `docmeta.record`
* Tokenization:

  * treat as “prose-like” tokenization (reuse tokenizer utilities)
  * apply STOP word filtering + stemming (like prose mode)
* Embeddings:

  * embed the markdown body (and optionally also embed `docmeta.record.summary`)
* Write artifacts to `getIndexDir(repoRoot,'records')` using existing:

  * `createIndexState`, `appendChunk`, `buildPostings`, `writeIndexArtifacts`
* Incremental caching:

  * optional but recommended: reuse existing incremental bundle mechanism OR implement a simpler manifest keyed by recordId
  * v1 acceptance: OK if records are re-indexed fully (records volume is usually low)

## 4) Add records search mode to `search.js`

### Update: `search.js`

* Extend `--mode` enum to include:

  * `records`
  * optionally `all` meaning `code+prose+records` (if you want; otherwise keep `both` as code+prose)
* Load records index artifacts:

  * file-backed from `index-records/` (v1 can be memory-only)
* Display section:

  * `===== 🧾 Records Results (...) =====`
* JSON output:

  * include record hits under `records`
  * include `mode='records'` in each hit

### Update: `src/search/output.js`

* Add generic filters:

  * `--file` (substring match against `chunk.file`)
  * `--ext` (exact match against `chunk.ext`)
* Add metadata filters (see below)

## 5) Implement metadata filters (core to triage)

### Update: `search.js` arg parsing

Add:

* `--meta key=value` (repeatable)
* `--meta-json '{"service":"api","env":"prod"}'` (optional convenience)

### Update: `src/search/output.js` `filterChunks()`

Add filtering against `chunk.docmeta.record`:

* Evaluate each `--meta` constraint with AND semantics
* Suggested behavior:

  * If `value` present: case-insensitive substring match against stringified field
  * If value omitted (e.g. `--meta cve`): check field exists and non-empty
  * Support numeric compares as stretch (`severityScore>=7`) but not required for v1

This enables:

* `--meta service=payments --meta env=prod --meta cve=CVE-2024-XXXX`
* `--meta status=accept`

## 6) Add ingestion tools (Dependabot + Inspector + generic)

Create new folder: `tools/triage/`

### New: `tools/triage/ingest.js`

CLI responsibilities:

* Inputs:

  * `--repo <path>` (defaults cwd)
  * `--source dependabot|aws_inspector|generic`
  * `--in <file>` JSON/JSONL
  * `--meta key=value` repeatable (service/env/team/owner/etc)
  * `--build-index` (optional: triggers records index build after ingest)
* For each entry in input:

  * normalize → `TriageRecord`
  * write JSON record (canonical)
  * render markdown view (human + indexable)
* Output:

  * print summary JSON with counts and paths
  * list of written recordIds

### New: `src/triage/normalize/`

Implement:

* `normalizeDependabot(raw, meta) -> TriageRecord`
* `normalizeAwsInspector(raw, meta) -> TriageRecord`
* `normalizeGeneric(raw, meta) -> TriageRecord`
  Each should:
* be resilient to missing fields (store parse warnings into `record.parseWarnings`)
* always produce the routing fields and `vulnId` if possible

### New: `src/triage/render.js`

* `renderRecordMarkdown(record) -> string`

  * single `#` heading containing: recordType + vulnId + package + service/env + severity
  * sections:

    * Summary
    * Environment context (from `exposure`)
    * Package / Asset details
    * References
    * Raw (optional; controlled by config)

## 7) Add decision/history support

### New: `tools/triage/decision.js` (or extend ingest.js)

Provide an ergonomic CLI to write decision records:

* `node tools/triage/decision.js --repo ... --finding <recordId> --status accept --justification "..."`
* Writes a `recordType='decision'` record and renders `.md`
* Decision record links back via `decision.findingRecordId`

History retrieval will be done via records search (context pack builder below).

## 8) Context pack generator (LLM-ready payload)

### New: `tools/triage/context-pack.js`

Inputs:

* `--repo <path>`
* `--record <recordId>` (finding)
* `--out <file>` default `<repoCacheRoot>/triage/context-packs/<recordId>.json`
  Behavior:

1. Load finding JSON record
2. Retrieve history:

   * search records index for:

     * same `cve`/`vulnId`
     * same `package.name`
     * same `service` and `env`
   * include up to `triage.contextPack.maxHistory`
3. Gather repo evidence using PairOfCleats search:

   * run queries (code + prose) derived from finding:

     * package name
     * manifestPath filename
     * vulnId / CVE string
     * likely import module name (if known)
   * capture top N hits each with:

     * file, kind, name, headline, scoreBreakdown, snippet
   * include up to `triage.contextPack.maxEvidencePerQuery`
4. Emit `ContextPack` JSON:

```json
{
  "recordId": "...",
  "generatedAt": "...",
  "finding": { ...normalized record... },
  "history": [ ...decision/finding records... ],
  "repoEvidence": {
    "queries": [
      { "query": "lodash", "mode": "code", "hits": [...] },
      { "query": "package-lock.json lodash", "mode": "prose", "hits": [...] }
    ]
  }
}
```

5. Print where it was written.

Implementation approach:

* v1 can call `node search.js ... --json-compact` via `child_process.spawnSync` and parse stdout.
* (Optional nicer follow-up) refactor reusable search runner into a module, but not required for v1.

## 9) MCP server enhancements (optional but high leverage for agent workflows)

If you want Codex/Claude agents to drive this directly:

### Update: `src/mcp/defs.js`

Add tool defs:

* `triage_ingest` (wrap `tools/triage/ingest.js`)
* `triage_decision` (wrap decision tool)
* `triage_context_pack` (wrap context pack tool)
* Extend existing `build_index` and `search` schemas to include `records` mode

### Update: `tools/mcp-server.js`

Add handlers that:

* resolve repoPath
* spawn the scripts
* stream progress notifications like existing tools do

---

# CLI / UX Expectations (Definition of Done)

## Ingest

* `node tools/triage/ingest.js --source dependabot --in tests/fixtures/triage/dependabot.json --meta service=api --meta env=prod`

  * creates `<repoCacheRoot>/triage/records/*.json` and `*.md`
  * prints counts + recordIds

## Index

* `node build_index.js --mode records --stub-embeddings`

  * creates `<repoCacheRoot>/index-records/chunk_meta.json` etc.

## Search (metadata-first)

* `node search.js "CVE-2024" --mode records --meta service=api --meta env=prod --json`

  * returns only records matching meta filters
  * each hit includes `docmeta.record` with promoted fields

## Decision + History

* `node tools/triage/decision.js --finding <recordId> --status accept --justification "..."`

  * decision record is searchable and linkable

## Context Pack

* `node tools/triage/context-pack.js --record <recordId>`

  * outputs JSON containing:

    * finding
    * history hits
    * repo evidence hits from code/prose index

---

# Tests + Fixtures (must-have for v1)

## Add fixtures

Create:

* `tests/fixtures/triage/dependabot.json`
* `tests/fixtures/triage/inspector.json`
* (optional) `tests/fixtures/triage/generic.json`

## New test runner

Add `tests/triage-records.js` that:

1. Runs ingest with `--stub-embeddings` mode later for indexing
2. Builds records index (`node build_index.js --mode records --stub-embeddings`)
3. Runs record search:

   * verify `--meta service=...` filters correctly
4. Generates a context pack:

   * verify JSON output structure and that it includes non-empty evidence arrays (even if small)

Update `package.json`:

* add script: `"triage-test": "node tests/triage-records.js"`
* (optional) include in `test-all`

---

# Implementation Notes / Guardrails

* **Keep PairOfCleats core behavior stable.**

  * Do not change default `build_index --mode all` semantics unless intentional.
* **Do not store triage data in the repo working tree.**

  * Use `repoCacheRoot` by default.
* **Limit bloat in chunk meta.**

  * Store *promoted* fields in `docmeta.record`, not the entire raw payload.
* **Make meta filtering robust.**

  * Missing fields should not crash; just fail the filter.
* **Treat record markdown as the indexed surface** (human-friendly), JSON as canonical.
