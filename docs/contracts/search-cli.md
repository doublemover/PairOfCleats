# Search CLI Contract (0.0.2)

This document defines the CLI interface and output contract for **search**.

- Command script: `search.js`
- CLI entrypoint: `pairofcleats search` (wrapper around `search.js`)

> Phase 11 adds **opt-in graph ranking** (ordering only; membership invariant) and may add a hardened **context expansion** mode. These features MUST NOT change default behavior unless enabled.

## Inputs

### Required
- A query string, or at least one nonempty structured filter with no query text, e.g.
  - `search.js "how does risk explain work"`
  - `search.js --mode code --return-type boolean --top 20 --json`

### Common flags
- `--help` (alias: `-h`): display search command help
- `--repo <path>`: repo root (defaults to current directory)
- `--mode code|prose|extracted-prose|records|both|all`: search mode
- `--top <n>` (alias: `-n`, `--n`): results per mode; page size for filter-only enumeration
- `--cursor <nextCursor>`: continue filter-only enumeration with the same filters, modes and indexed generation
- `--plain`: readable output without ANSI styles or hyperlinks
- `--top-per-repo <n>`: cap hits per repo in federated mode
- `--json`: emit JSON output
- `--compact`: compact JSON output
- `--stats`: include stats payload
- `--explain` / `--why`: include score explanation payload
- `--matched`: include matched query tokens in text output
- `--filter "<expr>"`: filter expression for file/lang/ext/type (see below)
- `--concurrency <n>`: federated/per-repo execution concurrency
- `--workspace <path>`: workspace manifest path for federated search
- `--cohort <selector>`: cohort selector for federated runs
- `--federated-strict`: fail federated runs on cohort/config mismatches
- `--repo-filter <pattern>`: include/exclude repos in federated runs
- `--select <selector>`: explicit result selection profile
- `--merge <mode>`: result merge strategy override
- `--snapshot <id>`: force snapshot id
- `--as-of <selector>`: resolve snapshot by temporal selector
- `--include-disabled`: include disabled workspace repos in federated runs
- `--tag <name>`: filter repos/workspaces by tag
- `--debug-include-paths`: include debug path traces in structured output

### Retrieval controls

- `--preset fast|hybrid|investigate`: select bounded retrieval defaults.
- `--match all|any|auto`: select query-token eligibility.
- `--candidates <n>`: bound candidate discovery separately from final results.
- `--ann-candidates independent|lexical-rerank`: discover vector candidates independently or rerank lexical candidates.
- `--deadline-ms <n>`: set a cooperative search deadline.
- `--output-bytes <n>`: bound structured output while retaining citation/follow-up fields.

### Filter flags
- `--file`, `--path`, `--lang`, `--ext`, `--type`
- `--case`, `--case-file`, `--case-tokens`
- `--author`, `--chunk-author`, `--import`, `--signature`, `--param`, `--inferred-type`, `--return-type`
- `--calls`, `--uses`, `--decorator`, `--throws`, `--reads`, `--writes`, `--mutates`, `--alias`, `--lint`, `--awaits`, `--visibility`, `--extends`, `--async`, `--generator`, `--returns`
- `--risk`, `--risk-tag`, `--risk-source`, `--risk-sink`, `--risk-category`, `--risk-flow`
- `--struct-pack`, `--struct-rule`, `--struct-tag`
- `--meta <key[=value]>` (repeatable), `--meta-json <json>`
- `--modified-after <iso-date>`, `--modified-since <days>`, `--churn <spec>`, `--branch <name>`
- `--branches`, `--loops`, `--breaks`, `--continues`

### Backend + ranking flags
- `--backend auto|sqlite|sqlite-fts|lmdb|memory|tantivy` (alias: `fts`)
- `--ann` / `--no-ann`
- `--ann-backend auto|lancedb|sqlite|hnsw|js`
- `--dense-vector-mode merged|code|doc|auto`
- `--allow-sparse-fallback`: allow sparse fallback when ANN path is unavailable
- `--allow-unsafe-mix`: allow mixed profile/index modes that are otherwise blocked
- `--graph-ranking-max-work <n>`, `--graph-ranking-max-ms <n>`
- `--graph-ranking-seeds top1|topK|none`, `--graph-ranking-seed-k <n>`
- `--bm25-k1 <n>`, `--bm25-b <n>`
- `--rrf-k <n>`: reciprocal-rank-fusion K override
- `--fts-profile <profile>`
- `--fts-stemming` / `--no-fts-stemming`
- `--fts-trigram` / `--no-fts-trigram`
- `--fts-weights <json|list>`
- `--model <id>`
- `--stub-embeddings`
- `--comments` / `--no-comments`
- `--non-strict` (allow legacy artifact fallback when manifests are missing)

### `--filter` expression
`--filter` accepts space- or comma-separated tokens. Supported keys are `file`/`path`, `lang`, `ext`, and `type`/`kind`.
Tokens without a key are treated as file/path filters. Unknown keys are rejected. `--filter` merges with the explicit filter flags above (ANDed).

## Outputs

### Text mode
Human readable results (ranked list, or indexed-order filter enumeration). Code entries include bounded, line-numbered working-tree excerpts when the source is available within the repo. Excerpts use lightweight lexical highlighting in a TTY. Non-TTY output, `NO_COLOR` (including an empty value), `TERM=dumb`, and `--plain` disable styles and hyperlinks. Repository-controlled escape sequences and bidi controls are sanitized before terminal display. Exact formatting may evolve.

Every displayed code hit is eligible for a source preview: up to eight lines for
the leading hit and three for later hits. A literal query-token occurrence selects
the preview window when found; otherwise the excerpt starts at the indexed chunk
offset. `>` marks visible, case-insensitive query text only. It does not assert why
the retrieval engine selected or ranked the hit, and semantic matches need not
contain query text. Use `--explain` for recorded score evidence and `--why` for
deeper analysis details.

These excerpts are current working-tree text at indexed offsets, not an indexed
snapshot or a freshness guarantee. Their line numbers are derived from the text
read, while the result's location remains its indexed source range. Edits can make
those differ. The preview reader examines at most 32 distinct file paths and 2 MiB per render,
with a 512 KiB per-file limit, and reuses a read only within that render. Preview
selection scans at most 64 Ki characters of a chunk. Missing, outside-root,
oversized or over-budget sources do not hide a result; only the preview is absent.

The summary counts displayed hits, not the total number of possible ranked
matches. Filter enumeration separately reports its exact indexed total and
continuation cursor. Narrow TTY output wraps long lines without splitting
graphemes; overflowing lines use plain text to avoid broken ANSI/link sequences.
Opaque cursor lines remain intact for copying. Pipes remain unstyled and omit
interactive next-step hints. JSON payloads are unaffected by these display choices.

### JSON mode
For a successful single-repository search, the CLI emits:
- `backend`: the selected retrieval backend
- `code`, `prose`, `extractedProse`, `records`: ranked hit arrays (including empty arrays)
- `bundles`: deterministic groups of related hits
- `retrieval`: backend selection, index freshness and cache metadata
- `pagination`: present for filter-only searches, with exact indexed match `total`, page `returned`, `hasMore`, `nextCursor`, and per-mode counts/offsets
- `stats`: added with `--stats` or `--explain`; explain data includes per-hit score breakdowns

`--compact` selects a smaller hit projection; without it, JSON output still strips
internal token arrays. Additional diagnostic or output-budget metadata can be
present when relevant. Consumers should retain unknown additive fields.

A successful single-repository response does not require an `ok`, `query` or
flat `results` field. Search-runner error JSON uses `ok: false`, `code` and
`message`; check the process exit status too, since wrapper/argument failures can
occur before the JSON search runner starts.

Workspace searches use a separate federated envelope with per-repository
outcomes and partial-success metadata; see the
[federated search contract](../specs/federated-search.md). Do not assume HTTP or
MCP response envelopes are identical to the standalone CLI payload.

> See `docs/contracts/search-contract.md` for semantic details. Phase 11 extends the explain payload with a graph ranking section when enabled.

## Phase 11 extensions to search

### A) Graph-aware ranking (opt-in)

Graph ranking is enabled via config (`retrieval.graphRanking.enabled`). The CLI only provides overrides:
- `--graph-ranking-max-work <n>` (work-unit cap)
- `--graph-ranking-max-ms <n>` (optional wall-clock fuse)
- `--graph-ranking-seeds top1|topK|none` (default: `top1`)
- `--graph-ranking-seed-k <n>` (only used for `topK`)

Config mapping (normative):
- `retrieval.graphRanking.enabled` (boolean)
- `retrieval.graphRanking.weights` (object; `degree`, `proximity`)
- `--graph-ranking-max-work` -> `retrieval.graphRanking.maxGraphWorkUnits`
- `--graph-ranking-max-ms` -> `retrieval.graphRanking.maxWallClockMs`
- `--graph-ranking-seeds` -> `retrieval.graphRanking.seedSelection`
- `--graph-ranking-seed-k` -> `retrieval.graphRanking.seedK`

#### Membership invariant (required)
When graph ranking is enabled:
1. Search MUST compute the baseline result set (the returned `topN`) without graph features.
2. Graph ranking may reorder *only* those results.
3. The returned result membership MUST be identical with graph ranking off/on.

#### Explain payload changes
When `--explain` is enabled and graph ranking is enabled, each hit SHOULD include:

```json
{
  "scoreBreakdown": {
    "baseline": { "...": "existing fields" },
    "graph": {
      "score": 0.123,
      "degree": 8,
      "proximity": 0.5,
      "weights": { "degree": 0.1, "proximity": 0.4 },
      "seedSelection": "top1",
      "seedK": null
    }
  }
}
```

### B) Context expansion (optional; separate from graph ranking)

Phase 11 hardens `src/retrieval/context-expansion.js` to be safe on worst-case repos and to prefer identity-first joins when graph artifacts exist.

Context expansion is config-driven (no CLI flags). When enabled via `retrieval.contextExpansion.*`, it MUST:
- be opt-in (default off),
- be bounded by explicit caps (`maxPerHit`, `maxTotal`, per-source caps, `maxWorkUnits`),
- record truncation metadata when caps trigger, and
- remain deterministic.

## Notes on the `pairofcleats` wrapper

`bin/pairofcleats.js` must not enforce a stale flag allowlist for `search`. The wrapper MUST accept all documented search flags and delegate parsing/validation to `search.js`.

## Filter-only enumeration

Omit positional query text and provide filters to enumerate all matching indexed chunks. No ANN, embeddings, sparse relevance cutoff, graph reranking, or context expansion participates. Results have `scoreType: "filter"`, `score: 0`, and `rankMethod: "indexed-order"`. `--top` bounds each mode's page; it does not truncate the matching set.

Repeat the same command with `--cursor <pagination.nextCursor>` until `hasMore` is false. One cursor carries independent offsets for every selected mode, including already exhausted modes. It binds the normalized filters, modes, backend/index signature, and indexed generation; changed filters or generation are errors. Relative modification dates retain the first page's cutoff. Output-budget truncation advances only over emitted hits; a budget that cannot fit any result fails explicitly. Query text with `--cursor` is rejected. Workspace enumeration is supported with `--workspace`: each page visits one eligible repository/mode in stable repository-ID/mode order. Its cursor binds workspace membership, filter arguments, relative-date anchor, and the workspace generation manifest. A page can be empty while `hasMore` is true. Continue until exhaustion. Unavailable modes are listed in `meta.completeness.unavailable`; `status: partial` never claims workspace-wide completeness. Strict requests reject unavailable modes. Publication during a page invalidates the request.

Coverage is explicitly `indexed-metadata`: all matches in the loaded index are reachable, but missing facts do not become matches. This does not assert whole-program compiler completeness. `--return-type` uses exact case-sensitive type-expression tokens (ignoring inter-token whitespace). It excludes containing types such as `Promise<boolean>`, `boolean[]`, `boolean | string`, and nominal lookalikes from a `boolean` query. Recorded tooling facts take precedence over declaration fallbacks; heuristic inferred returns and symbolic display labels are not promoted to compiler facts. `filterEvidence.returnType` preserves the matching fact source. Alias expansion, assignability, union reordering, and structural type equivalence are not performed.

`--type ClassDeclaration` selects indexed chunk kinds. `--extends Base` matches a recorded parent name exactly; `--calls target` matches the recorded callee, not the caller's own name. Relations are available only to the extent recorded by the language/tooling providers, and these name predicates do not resolve overloads or ambiguous cross-file symbol identities.

Full JSON retains symbolic references in chunk metadata; `--compact` exposes the same unmodified envelope as `typeExpressions`, including its declaration provenance and interpretation. For finite-string membership or zero/one/many classification, copy its exact published reference into the existing generation-pinned [detail type query](../guides/semantic-index.md#shared-symbolic-finite-string-types). These operations do not enumerate runtime values or imply general type equivalence, and symbolic display labels are not `--return-type` facts.
