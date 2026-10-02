# Outstanding branch and product capability review

Snapshot: 2026-10-02. Target: `hydro/complete-outstanding-work`, based on
NEON_TIDE, with the main squash ancestry reconciled. This is an implementation
review with bounded affected-test validation, not a release-wide acceptance claim.
The canonical execution queue remains [the roadmap](roadmap.md).

## Remote branches and open pull requests

All 11 remote heads were inventoried. No branch was merged, deleted, or force-pushed,
and no pull request was closed by this review.

| Branch / PR | Disposition |
| --- | --- |
| `main` at `b9398da2` | Already an ancestor of the completion branch; its tree is the historical NEON_TIDE squash already reconciled by `81bc5774` |
| `NEON_TIDE` at `1938552f`, PR #218 | Entire branch is an ancestor; old PR mergeability describes that old branch, not this completion branch |
| `hydro/complete-outstanding-work` | Current implementation target |
| `mess` at `64b90824`, PR #20 | 126 commits absent by ancestry; 120 nonmerge commits reviewed as capability families, including its unique 89-file tip patch |
| `phase23-turbo-wombat` at `85555cbb` | 237 commits absent by ancestry; 211 nonmerge commits and its 201-line historical plan reviewed as capability families |
| Dependabot Svelte group, PR #105 | Target 5.53.5 superseded by package and lock 5.57.1 |
| Dependabot SWC, PR #102 | Target 1.15.13 covered by package `^1.15.13`, lock 1.16.13 |
| Dependabot c8, PR #101 | Target 10.1.3 superseded by package and lock 12.0.0 |
| Dependabot jsdoccomment, PR #100 | Target 0.84.0 matches package and lock 0.84.0 |
| Dependabot ESLint, PR #88 | Target 10.0.1 matches package and lock 10.0.1 |
| Dependabot yargs, PR #85 | Target 18.0.0 covered by package `^18.0.0`, lock 18.2.0 |

The six dependency PRs contain no remaining version upgrade to transplant. Both
root lock specifications and installed-package lock entries were inspected.
This does not claim the old PR branches are mergeable or that upstream security
alerts have already closed. The existing dependency validation report remains the
evidence for runtime compatibility and audits.

The two January branches predate extensive refactoring and later hardening. Raw
tree replacement would remove newer capabilities. Their old file paths were
traced to current owners, and behavior was compared rather than treating every
nonancestor commit as missing implementation. The two branches share all but one
of `mess`'s nonmerge commits; the extra `64b90824` patch was reviewed separately.

## Recovered fixes implemented in this pass

1. LSP initialization negotiation could select UTF-16 before inspecting supported
   top-level UTF-8/UTF-32 fields. Recognized-value selection now precedes fallback.
   Overlong positions also clamp before LF/CRLF terminators instead of spilling
   onto the following line. Regression: `tests/tooling/lsp/tooling.test.js`.
2. Embedding identity normalization converted explicit null, blanks, booleans,
   and empty arrays to numeric zero. Missing values now retain null/defaults;
   valid numeric strings and explicit numeric zero retain their meaning.
   Regression: `tests/indexing/embeddings/identity.test.js`.
3. Metadata schema types did not enforce ordered offset/line/page/paragraph
   bounds or containment within segments. Standalone metadata and row-based
   artifact validators now share semantic checks. The writer also preserves the
   documented `segment.ext`. Regression: `tests/indexing/metav2/metadata-v2.test.js`.
4. Context-window estimation copied and sorted every discovered path to retain
   only 20. A bounded selection keeps exactly the same lexicographic first 20,
   with original duplicate, Unicode, and case-sensitive ordering semantics.
   Auxiliary path storage is bounded by 21 entries; selection is O(n log 20)
   comparisons plus bounded insertion work, rather than O(n log n) full sorting.
   This is an algorithmic improvement, not a measured end-to-end speedup claim.
   Regression: `tests/unit/context-window-sampling.unit.js`.
5. The old `mess` callback shielding had been lost during scheduler extraction.
   A throwing firing hook could prevent work, and a throwing/rejecting error hook
   could cause an uncaught failure. Both are contained while scheduled work still
   runs. Regression: `tests/indexing/watch/debounce.test.js`.
6. Risk flow-cap truncation retained `status: "ok"`. Omitted distinct flows now
   produce an explicit `maxFlows` capped result and stop further analysis;
   exactly filling a cap without omission remains complete. Whole-chunk caps now
   run before allocating the line array. Regression:
   `tests/indexing/risk/risk-contract-matrix.test.js`.
7. Metadata/risk documentation now reflects actual nullability, type provenance,
   segment context, ordered parameter semantics, supported rule fields, and
   partial-result status. Historical speculative proposals are not silently
   introduced as new public contracts.

## Historical Phase 23 capability disposition

| Historical family | Current source / contract evidence and disposition |
| --- | --- |
| Nested inferred/tooling parameter and local maps | `src/index/metadata-v2.js` normalizes nested maps and partitions tooling entries; `metadata-v2-param-map-tooling-split.test.js` covers parameter retention |
| Declared parameter/return types | `buildDeclaredTypes` preserves annotations and collected return types; defaults feed `src/index/type-inference.js` rather than becoming declared types |
| Optional declared defaults/locals proposal | No current `localTypes` producer or active declared-default schema; documented as outside the emitted contract, rather than fabricating a new facet |
| Metadata deep validation | Canonical schema in `src/contracts/schemas/analysis/metadata.js`, nested type schema in `primitives.js`, artifact validation and equivalence checks already exist; missing range semantics fixed above |
| Ordering and empty values | Params preserve declaration order; annotations and risk evidence preserve deterministic traversal order. Sorting parameter names would lose signature order. Actual null/empty behavior is documented |
| Producer/embedded naming | Structured `tooling` plus compatibility `generatedBy`/`embedded` behavior retained and documented; no breaking rename |
| SafeRegex compilation and diagnostics | `src/index/risk-rules.js` uses `compileSafeRegex` with configured flags and bounded diagnostics; invalid patterns cannot abort normalization |
| Long-line shielding | `src/index/risk/shared.js` and `risk.js` catch evaluation failures; contract matrix covers long lines |
| Risk resource bounds and prefilters | Single line traversal evaluates categories; byte/line early returns, node/edge/time stops and prefilters exist; allocation and flow-cap reporting gaps fixed above |
| File-scope/match-count proposals | These are not current rule-bundle fields. The supported line-based, first-evidence-per-rule semantics are now explicit in the guide |
| Git blame/churn policy and caching | Runtime analysis policy controls blame; SCM provider requests metadata with `blame: false`, batches history, and uses separate root/commit-scoped caches and failure backoff; expensive legacy helper defaults are not the indexer policy |
| LSP request lifecycle | `src/integrations/tooling/lsp/client.js` supplies default request timeouts, cancels timed-out requests, and clears pending state on teardown |
| Diagnostic collection | Current LSP diagnostics use bounded URI/chunk buffers and overlap projection, with workspace/provider-specific diagnostics paths and tests; asynchronous notification completeness is provider-dependent |
| Unicode/CRLF offsets | UTF-8/UTF-16/UTF-32 conversion exists; fallback precedence and line-end gaps fixed above, with emoji and CRLF coverage |
| Symbol overlap mapping | `providers/lsp/target-index.js` implements indexed overlap/containment/name ranking; it supersedes strict-only containment |
| TypeScript resolution and naming | `tooling/typescript/load.js` implements repo/cache/global lookup; normalized destructuring and symbol mapping are covered by `typescript-contract-matrix.test.js` |
| Type merge policy | `type-inference.js` merges confidence by maximum, retains first available evidence/shape, and unions elements; source order is retained rather than inventing evidence aggregation semantics |
| Complex signatures | Current C-like/Python/Swift and additional-language parsers use shared nesting-aware helpers; signature matrix tests cover nested templates, generics, defaults, and language-specific forms |
| Markdown double parsing | `src/index/segments/markdown.js` collects fenced and inline spans from one micromark event stream |
| Repeated provider reads | Providers receive virtual documents; TypeScript's virtual compiler host reads supplied text first and delegates only absent files to disk |
| Unified analysis policy | `src/index/build/runtime/policy.js` and canonical policy schema coordinate metadata, risk, Git, and inference modes |

## Other historical branch capability families

- Retrieval families (BM25/RRF, fielded/filter indexing, query intent, structural
  search, context expansion, core API caching) have current owners under
  `src/retrieval`, `src/graph`, `src/context-pack`, and `src/integrations/core`.
- ANN families are retained through current HNSW/LanceDB and external sparse
  backend modules. HNSW supports backup candidates, model/dimension/space guards,
  typed vectors, and empty candidate sets; current ANN contract tests cover them.
- The `mess` embedding/cache patch is superseded by shared embedding identity,
  canonical vector validation, atomic cache IO, and the modern standalone build
  pipeline under `tools/build/embeddings`. Missing-document vectors intentionally
  use a zero-length marker; blindly restoring the old strict-empty rejection
  would conflict with the current sparse document-vector contract.
- Large/sharded JSON, JSONL, zstd, binary-columnar and file-metadata work lives in
  current artifact-IO, contracts and storage owners. Old flattened script paths
  were reorganized under `tools/build`, `tools/setup`, `tools/service`, and
  `tools/shared`; path removal alone is not loss of a feature.
- Tree-sitter lifecycle/grammar limits, Python AST workers, language passes,
  deterministic IDs, encoding, call links and type enrichment have later runtime
  owners and dedicated test matrices. The historical implementation is not a
  compatible substitute for the current USR/identity pipeline.
- Sublime and VS Code search/lifecycle/context/risk integrations remain present.
  API/MCP search, streaming, service caching and command dispatch have later
  contract owners; the old patch's removals would regress these surfaces.
- Benchmark tiers, resource envelopes, stale-lock cleanup, progress reporting,
  test lanes, evaluation and release tooling are current supported surfaces.
  Their broad performance/CI/platform campaigns remain deferred by instruction.

## Validation and remaining boundary

### Subsequent current-source correctness checks

Continued review after the initial checkpoint found and corrected two additional
implementation gaps rather than treating branch reconciliation as product
completion:

- Reconverging local-risk aliases duplicated identical source-evidence objects
  exponentially. A 12-alias regression reproduced premature `maxEdges` truncation
  before the sink. Stable original-object deduplication preserves distinct source
  records and traversal order; explicit zero confidence also retains its value.
  The risk contract, rule configuration, and invalid-pattern diagnostic selectors
  passed (3 tests, 0.314 s; sampled peak aggregate RSS 118.75 MiB).
- LSP asynchronous write failures, server-request replies, initialization, and
  shutdown could affect a replacement transport after restart. Each continuation
  now checks its originating process/writer generation. Four focused generation,
  closed-transport shutdown, normal shutdown, and timeout-cancellation selectors
  passed (1.32 s; sampled peak aggregate RSS 150.05 MiB), including current-session
  controls, reused server request IDs, and initialization failure behavior.

Both batches passed changed-file ESLint under the same one-CPU, 512 MiB Node,
sampled 1 GiB aggregate guard and 30-second per-test limit. These source fixes do
not turn the deferred release-wide validation into a completed campaign.

### Initial checkpoint evidence

The 11 affected tests named for this pass all passed in three sequential groups
(2, 3, and 6). Group test durations were 0.198 s, 4.35 s, and 2.15 s; the largest
sampled aggregate RSS was 318.53 MiB. Every group used one CPU, one test job,
512 MiB Node old-space, a sampled 1 GiB descendant-RSS stop, no retries, and a
30-second per-test limit. The LSP/identity failures were reproduced before their
fixes. An initial metadata substring selected four tests rather than three and
was stopped by the selection guard before execution; the corrected exact selector
ran the intended three. No failed selection is counted as a test pass.

Changed-file ESLint formatting and governance generation passed. Canonical lane
memberships remain gate 35, ci-lite 769, ci 121, ci-long 18, and USR conformance 11;
the new sampling unit test is discoverable in the unit lane. No tests were removed.

Focused regression receipts are recorded with this checkpoint; historical test
filenames above identify coverage owners and are not claims that every test was
rerun. The unchanged broad CI, platform, release, CodeQL, and measured-performance
gaps remain explicit in the roadmap. No universal absence-of-bugs or release-ready
claim follows from branch reconciliation or a finite source review.
