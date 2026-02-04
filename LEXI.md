# LEXI

This document consolidates the Phase 11.9 lexicon specs into a complete, repo-aligned implementation plan with granular tasks, tests, and touchpoints. The draft spec content has been absorbed here; future/lexi drafts can be removed once this plan is the single source of truth.

---

## Evaluation Notes (by document)

These notes assume the Phase 11.9 specs are promoted into `docs/specs/` (see 11.9.0 tasks). Any discrepancies should be resolved in those canonical docs first, then reflected here.

### phase-11.9-lexicon-aware-relations-and-retrieval-enrichment.md
- Well structured and matches repo architecture; touchpoints listed are mostly accurate.
- Adjustments needed:
  - `src/retrieval/pipeline.js` is the actual scoring entrypoint; any new boost/candidate policy work should be wired there and in `src/retrieval/pipeline/candidates.js` (for candidate set building).
  - Retrieval options parsing for ANN candidate controls is not currently exposed in `src/retrieval/cli/normalize-options.js`; the phase should include parsing and config schema updates if these knobs are to be configurable.
  - Relation filtering should explicitly preserve stable ordering and avoid filtering builtins/types by default (already stated); for JS-like languages where keywords can be property names, limit keyword lists to safe identifiers or add per-language allowlists.

### spec-language-lexicon-wordlists.md
- Solid and conservative; aligns with a fail-open loader.
- Ambiguity: "ASCII only" is safe but may exclude keywords for some languages (e.g., localized keywords). This should be explicit as a v1 constraint with a future v2 note.
- Add a clearer contract for `extractSymbolBaseName` and document separators ordering (consistent with relations spec).
- Ensure the canonical wordlist format includes `formatVersion`, `languageId`, and required arrays, with a strict schema (additionalProperties=false).

### spec-lexicon-relations-filtering.md
- Correct placement and safety constraints.
- Ambiguity: Should filtering also apply to `rawRelations.imports/exports`? The spec says no; keep it explicit and add a note that only usages/calls/callDetails/callDetailsWithRange are filtered in v1.
- Recommend adding per-language overrides for stopword sets (e.g., JS keyword subset) to avoid over-filtering.

### spec-lexicon-retrieval-boosts.md
- Good; boost-only with clear explain payload.
- Adjustment: query token source is `src/retrieval/cli/query-plan.js`, but the actual tokens are available in the pipeline context. Wire from existing query plan rather than recomputing.
- Clarify whether `queryTokens` are case-folded using `caseTokens` (current pipeline has `caseTokens` and `caseFile` flags).

### spec-chargram-enrichment-and-ann-fallback.md
- Matches current architecture.
- Adjustment: `annCandidateMinDocCount` and related knobs are not currently parsed or surfaced; add explicit config plumbing and schema updates in this phase.
- Candidate policy should be shared between ANN and minhash fallbacks (currently the pipeline reuses `annCandidateBase` for minhash); the policy should be applied consistently.

---

## Spec Extracts to Carry Forward (Authoritative Details)

These are the non-negotiable details that must be preserved when the Phase 11.9 specs are promoted into `docs/specs/` and implemented.

### Lexicon wordlist format (v1)
- Required fields: `formatVersion` (const 1), `languageId`, `keywords[]`, `literals[]`.
- Optional fields: `types[]`, `builtins[]`, `modules[]`, `notes[]`.
- File layout: `src/lang/lexicon/wordlists/_generic.json` and `src/lang/lexicon/wordlists/<languageId>.json` (languageId must match registry id).
- Normalization rules: lowercase, trim, ASCII-only, non-empty, dedupe. Sort on disk, but loader must normalize regardless.
- Derived stopword domains:
  - `relations = keywords ∪ literals`
  - `ranking = keywords ∪ literals ∪ types ∪ builtins`
  - `chargrams = keywords ∪ literals` (optionally extended to types/builtins when chargramStopwords is enabled)
- Fail-open loader with `_generic` fallback and one-time warnings on schema failures.

### Lexicon schema requirements
- `language-lexicon-wordlist.schema.json` v1:
  - `additionalProperties=false`
  - `formatVersion` const 1
  - arrays of strings (minLength 1) for wordlist fields
- The schema must be registered under `src/contracts/registry.js` if validation is enforced at load time.

### Relations filtering (build-time)
- Filter only `usages`, `calls`, `callDetails`, `callDetailsWithRange` (not imports/exports in v1).
- `extractSymbolBaseName` separators (split, take last non-empty): `.`, `::`, `->`, `#`, `/`.
- Trim trailing `()`, `;`, `,` from base name.
- Preserve stable order; optional stable de-dupe (keep first occurrence).

### Retrieval relation boosts
- Signal tokens derive from `buildQueryPlan(...)` output (use pipeline query plan, not recompute).
- Per-hit stopword filtering in ranking domain; case-folding must respect `caseTokens`.
- Scoring: `boost = min(maxBoost, callMatches*perCall + usageMatches*perUse)` with small defaults.
- Explain output includes `relationBoost` with bounded token lists and deterministic ordering/truncation.

### Chargram enrichment + ANN candidate policy
- Allowed `chargramFields`: `name`, `signature`, `doc`, `comment`, `body` (default `name,doc`).
- Optional `chargramStopwords` uses lexicon `chargrams` domain for token filtering.
- Candidate policy rules (deterministic):
  - `null` candidates -> null (full ANN)
  - empty set -> empty set (no ANN hits)
  - too large -> null
  - too small with no filters -> null
  - filtersActive + allowedIdx -> allowedIdx
  - otherwise -> candidates
- Explain `annCandidatePolicy` includes `inputSize`, `output`, `reason` (`noCandidates`, `tooLarge`, `tooSmallNoFilters`, `filtersActiveAllowedIdx`, `ok`).

---

# Phase 11.9 – Lexicon-Aware Relations and Retrieval Enrichment

## Dependency Graph (must land in order)
1. 11.9.0 (contracts + config surfaces) → 11.9.1 (lexicon loader + wordlists).
2. 11.9.1 must land before any filtering/boosting/chargram changes.
3. 11.9.2 (relations filtering) and 11.9.4 (chargram enrichment + ANN policy) can run in parallel after 11.9.1.
4. 11.9.3 (retrieval boosts) should follow 11.9.1 and can land after 11.9.2/11.9.4.
5. 11.9.5 (observability + rollout) lands last and updates logs/explain surfaces once behavior is stable.

## Feature Flags + Defaults (v1)
- Lexicon loader: enabled by default; fail-open on missing/invalid files.
- Relation filtering: enabled only at `quality=max` unless explicitly enabled in config.
- Relation boosts: disabled by default; must be explicitly enabled.
- Chargram enrichment: disabled by default; must be explicitly enabled.
- ANN/minhash candidate safety policy: always on (safety), but explain output is opt-in.
- Global off-switch: `indexing.lexicon.enabled=false` disables lexicon filtering and related boosts.

## Contract Surface (versioned)
- Lexicon wordlists: schema-versioned JSON, validated on load.
- Explain output: `relationBoost` and `annCandidatePolicy` fields added with a versioned explain schema.
- Config schema: new lexicon + ANN candidate keys explicitly versioned in docs/config schema and inventory.

### Contract Ownership (authoritative sources)
- Config surface: `docs/config/schema.json` + `docs/config/contract.md`.
- Lexicon wordlist schema: `docs/schemas/language-lexicon-wordlist.schema.json` + `src/contracts/registry.js`.
- Retrieval explain schema: `docs/specs/lexicon-retrieval-boosts.md` + `docs/specs/chargram-enrichment-and-ann-fallback.md`.
- Build-time filtering contract: `docs/specs/lexicon-relations-filtering.md`.

### Explain Schema Versioning
- Introduce a small `explainVersion` or similar field in explain payloads if adding `relationBoost`/`annCandidatePolicy` changes shape.
- Consumers must ignore unknown explain fields; breaking changes require a version bump.

## Performance Guardrails
- All lexicon filtering must be O(n) over relations; no per-token regex or substring scans.
- Avoid new allocations in inner loops; reuse buffers/arrays where possible.
- Relation boost matching must be bounded by query token count (no unbounded scans).

### Performance Budgets (explicit)
- Per-file filtering must stay linear in relation count; add a perf test or benchmark if relation count exceeds a threshold.
- Per-query boost matching must cap token comparisons at a fixed multiplier of query token count.
- Add explicit counters for relations filtered and boost matches when verbose logging is enabled.

## Compatibility: cache/signature impact
- Build signature inputs must include lexicon configs (stopwords, chargramFields/stopwords) and ANN candidate knobs.
- If signature shape changes, bump `SIGNATURE_VERSION` and update incremental tests accordingly.

### Signature Decision Table
| Change type | Include in signature payload | Bump `SIGNATURE_VERSION`? |
| --- | --- | --- |
| New config key that changes behavior | Yes | No (unless payload shape changes) |
| New derived stopword domain or semantics | Yes | Maybe (if output changes without config) |
| New explain-only field | No | No |
| Lexicon schema version bump | Yes | Yes |

## Out of Scope (v1)
- Non-ASCII language keywords (explicit v1 constraint).
- Language-specific semantic parsing beyond wordlists.
- Heuristic name stemming or fuzzy matching.
- Unicode normalization unless explicitly enabled.

---

## ASN-X – Advanced Symbol Normalization + Cross-Language Inference (v1‑X)

### Objective
Provide a deterministic, high‑throughput symbol normalization layer that **includes cross‑language semantic inference**, **Unicode normalization by default**, **fuzzy matching**, **stemming**, and **heuristic tokenization**, while integrating with existing type inference and semantic IDs.

### Scope (explicit)
- Operates on **string symbol names** and **query tokens**.
- Coexists with semantic IDs; never mutates or replaces them.
- Enables cross‑language matching when semantic IDs are unavailable.

### Non‑goals
- Full semantic equivalence proofs.
- Runtime dynamic dispatch resolution.
- Cross‑repo semantic inference.

### Core Contract: Dual‑track identity
- **Track A (semantic ID):** chunkUid/symbolId/cross‑file inference IDs win when present.
- **Track B (canonical string):** ASN‑X canonical key used for filtering, boosts, and fallback matching.

### Unicode normalization (default)
- Apply **NFKC** to all symbol tokens and query tokens.
- Normalize whitespace to single spaces, strip control characters.

### Heuristic tokenization (deterministic)
- Split on `.`, `::`, `->`, `#`, `/`, `:`, `@`.
- Split camelCase + snake_case + numeric boundaries.
- Preserve input order, then stable‑sort for canonical sets.

### Stemming + fuzzy matching
- Stemming: lightweight, applied only to tokens length ≥ 4; skip stopwords and numerics.
- Fuzzy: max edit distance **1**, only when token count ≤ cap (default 32).
- Fuzzy used only for **cross‑language candidate linking** and **query boosts**.

### Canonical key pipeline (ordered)
1. NFKC normalize
2. Separator normalization (language profile)
3. Strip generics/templates
4. Strip parameter lists
5. Normalize optional chaining / non‑null assertions
6. Case normalize (language profile)
7. Tokenize
8. Stem tokens
9. Stable‑sort tokens
10. Join with canonical separator

### Cross‑language semantic inference
Priority order:
1. Semantic IDs
2. Canonical key match
3. Token overlap + fuzzy score (bounded)

Deterministic confidence score:
```
confidence = w_id * idMatch
           + w_key * keyMatch
           + w_overlap * tokenOverlap
           + w_fuzzy * fuzzyScore
```
Defaults: `w_id=0.5`, `w_key=0.3`, `w_overlap=0.15`, `w_fuzzy=0.05`.

### Config surface (v1‑X)
```
indexing.symbolNormalization: {
  enabled: true,
  version: 1,
  unicodeNormalization: "NFKC",
  stemTokens: true,
  fuzzyDistance: 1,
  tokenOverlapThreshold: 0.6,
  maxTokenCount: 32,
  maxFuzzyCandidates: 128,
  languages: { ... }
}
retrieval.symbolNormalization: {
  enabled: true,
  useForRelationBoosts: true,
  fuzzyMatchQueryTokens: true
}
```

### Decision Tables (explicit defaults)
| Concern | Default | Rationale | Override |
| --- | --- | --- | --- |
| Unicode normalization | NFKC | collapse visually‑equivalent glyphs | `unicodeNormalization: "none"` |
| Fuzzy distance | 1 | avoid false positives while catching common typos | `fuzzyDistance: 0` to disable |
| Token overlap threshold | 0.6 | require majority overlap | `tokenOverlapThreshold` |
| Case folding | language profile | preserve semantics | per‑language toggle |

### Integration points
- **Indexing:** normalize names in `rawRelations` filtering; attach `normalizedKey` where useful.
- **Retrieval:** normalize query plan tokens; use normalized tokens in relation boosts.
- **Map:** optional `normalizedSymbolKey` on members; aggregates can use normalized keys.

### Conflict resolution rules
- If semantic ID exists, it is authoritative and **wins** over canonical key matches.
- If canonical key match conflicts with semantic ID, log once (structured warning) and prefer semantic ID.

### Performance guardrails
- Token count cap enforced (default 32).
- Fuzzy candidates cap enforced (default 128).
- O(n) tokenization; no backtracking regex.
- Short‑circuit fuzzy path when caps exceeded.

### Failure modes (bounded + deterministic)
- If caps exceeded, **fail‑open** by using canonical key only (no fuzzy).
- If Unicode normalization fails on input, emit warning and fallback to raw token.

### Explain output (when enabled)
```
symbolNormalization: {
  enabled: true,
  unicode: "NFKC",
  stemmed: true,
  fuzzyDistance: 1,
  normalizedKey: "...",
  tokens: ["..."],
  tokenOverlap: 0.72,
  confidence: 0.83
}
```

### Concrete payload examples (normative)
Example normalized map member:
```
{
  "id": "chunkUid:abc",
  "name": "Foo<T>.bar",
  "normalizedSymbolKey": "foo.bar"
}
```

Example explain payload:
```
{
  "symbolNormalization": {
    "enabled": true,
    "unicode": "NFKC",
    "stemmed": true,
    "fuzzyDistance": 1,
    "normalizedKey": "foo.bar",
    "tokens": ["foo", "bar"],
    "tokenOverlap": 0.67,
    "confidence": 0.8
  }
}
```

### Tests (required)
- `tests/asn/asn-determinism.test.js`
- `tests/asn/asn-nfkc-normalization.test.js`
- `tests/asn/asn-tokenization.test.js`
- `tests/asn/asn-stemming.test.js`
- `tests/asn/asn-fuzzy-distance.test.js`
- `tests/asn/asn-fuzzy-cap.test.js`
- `tests/asn/asn-cross-language-equivalence.test.js`
- `tests/asn/asn-confidence-scores.test.js`
- `tests/indexing/asn-relations-filtering.test.js`
- `tests/retrieval/asn-relation-boost.test.js`
- `tests/map/asn-edge-aggregate-grouping.test.js`
- `tests/asn/asn-performance-budget.test.js`

### Telemetry (required counters)
- `asn.tokens.normalized`
- `asn.tokens.stemmed`
- `asn.fuzzy.candidates`
- `asn.fuzzy.droppedByCap`
- `asn.conflicts.semanticVsCanonical`

### Performance targets (explicit)
- ≤ 2ms per 1k symbol tokens in normalization path.
- ≤ 5ms per 1k relation entries in filtering path.

### Language coverage checklist (must complete)
- TS/JS, Python, Rust, Java, C/C++, Swift, Go.
- Each profile must specify: separators, generics stripping, param stripping, case behavior.

### Migration/compatibility
- ASN‑X is additive; no breaking changes to existing artifact schemas.
- If `normalizedSymbolKey` is added, consumers must ignore unknown fields.

## 11.9.0 – Cross-cutting Setup and Contracts

### Goals
- Establish the lexicon contract, schema, and config surfaces.
- Align config/CLI/doc surfaces with current codebase.

### Additional docs/specs that MUST be updated
- `docs/config/schema.json` + `docs/config/contract.md` + `docs/config/inventory.*`
- `docs/specs/language-lexicon-wordlists.md`
- `docs/specs/lexicon-relations-filtering.md`
- `docs/specs/lexicon-retrieval-boosts.md`
- `docs/specs/chargram-enrichment-and-ann-fallback.md`

### Touchpoints
- `src/lang/` (new lexicon module)
- `src/shared/postings-config.js` (new fields)
- `src/retrieval/cli/normalize-options.js` (new ANN candidate config knobs)
- `src/retrieval/cli/query-plan.js` (query token source for boosts)
- `src/retrieval/output/explain.js` + `src/retrieval/output/format.js` (explain payload surfacing)
- `src/index/build/indexer/signatures.js` (incremental signature inputs / cache invalidation)
- `docs/config/schema.json`, `docs/config/contract.md`, `docs/config/inventory.*` (config surface)
- `docs/specs/*` (lexicon + retrieval specs, if promoted to canonical docs)
 - `src/contracts/registry.js` (register lexicon schema if added)
 - `src/contracts/schemas/*` + `src/contracts/validators/*` (lexicon wordlist schema)

### Tasks
- [ ] Decide canonical location for lexicon spec files (recommend `docs/specs/lexicon-*.md`).
- [ ] Add/extend config schema entries for:
  - `indexing.postings.chargramFields`
  - `indexing.postings.chargramStopwords`
  - `retrieval.annCandidateCap`
  - `retrieval.annCandidateMinDocCount`
  - `retrieval.annCandidateMaxDocCount`
  - `retrieval.relationBoost` (if exposed in config; otherwise document as quality-gated internal).
- [ ] Document defaults and quality gating in `docs/config/contract.md` or equivalent.
- [ ] Update config inventory docs after schema changes (keeps script surface tests green).
- [ ] Update build signature inputs to include lexicon + postings config so incremental caches reset:
  - `buildIncrementalSignaturePayload(...)` should include lexicon config (stopword policies) and new postings fields.
  - Consider bumping `SIGNATURE_VERSION` if signature shape changes.
 - [ ] Add an explicit config flag to disable lexicon features globally (`indexing.lexicon.enabled=false`).
 - [ ] Define and document versioning rules for lexicon wordlists and explain schema changes.

### Tests
- [ ] `tests/config/` schema drift tests updated if config schema changes.
- [ ] `tests/indexer/incremental/signature-lexicon-config.test.js` (signature changes when lexicon/postings config changes).
 - [ ] `tests/config/config-inventory-lexicon-keys.test.js` (inventory includes lexicon keys).
 - [ ] `tests/config/config-defaults-lexicon-flags.test.js` (defaults match documented behavior).

---

## 11.9.1 – Language Lexicon Assets and Loader

### Objective
Provide a standardized lexicon for all language registry ids, with a cached loader and derived stopword sets.

### Touchpoints
- New:
  - `src/lang/lexicon/index.js` (public surface)
  - `src/lang/lexicon/load.js` (file loading + caching)
  - `src/lang/lexicon/normalize.js` (lowercase/ASCII normalization)
  - `src/lang/lexicon/wordlists/_generic.json`
  - `src/lang/lexicon/wordlists/<languageId>.json`
  - `docs/specs/language-lexicon-wordlists.md` (if promoted)
  - `docs/schemas/language-lexicon-wordlist.schema.json` (or similar; keep consistent with other schemas)
- Existing registry:
  - `src/index/language-registry/registry-data.js` (language ids)

### Tasks
- [ ] Implement lexicon module:
  - [ ] `getLanguageLexicon(languageId, { allowFallback })` -> returns normalized sets.
  - [ ] `isLexiconStopword(languageId, token, domain)` for `relations|ranking|chargrams`.
  - [ ] `extractSymbolBaseName(name)` shared helper.
  - Must split on `.`, `::`, `->`, `#`, `/` and trim trailing `()`, `;`, `,`.
  - [ ] Expose per-language overrides in the lexicon JSON (e.g., allowlists/exclusions for relations stopwords).
- [ ] Loader behavior:
  - [ ] Use `import.meta.url` to resolve wordlist directory.
  - [ ] Cache in `Map<languageId, LanguageLexicon>`.
  - [ ] Fail-open: missing or invalid => `_generic`.
  - [ ] Emit a single structured warning on invalid lexicon files (no per-token spam).
  - [ ] Warning contract: include `languageId`, resolved file path, failure reason, and fallback target.
- [ ] Loader must be deterministic: stable ordering, no locale-sensitive transforms.
- [ ] Add schema validation for each wordlist file.
  - [ ] Register schema in `src/contracts/registry.js` and validate on load.
- [ ] Add lexicon files for each language id in the registry; keep v1 conservative (keywords + literals only).
  - Note: For JS/TS, keep keywords list conservative to avoid filtering property names.

### Tests
- [ ] `tests/lexicon/lexicon-schema.test.js`
- [ ] `tests/lexicon/lexicon-loads-all-languages.test.js`
- [ ] `tests/lexicon/lexicon-stopwords.test.js` (verify derived stopword sets)
- [ ] `tests/lexicon/lexicon-fallback.test.js` (missing/invalid file -> _generic)
- [ ] `tests/lexicon/extract-symbol-base-name.test.js` (separators `.`, `::`, `->`, `#`, `/` and trailing punctuation trimming)
- [ ] `tests/lexicon/lexicon-ascii-only.test.js` (explicit v1 constraint)
 - [ ] `tests/lexicon/lexicon-warning-contract.test.js` (single warning with required fields)
 - [ ] `tests/lexicon/lexicon-per-language-overrides.test.js`

---

## 11.9.2 – Build-Time Lexicon-Aware Relation Filtering

### Objective
Filter `rawRelations` before building `file_relations` and `callIndex`, using lexicon stopwords for relations.

### Touchpoints
- `src/index/build/file-processor/cpu.js`
  - Where `rawRelations` is produced and `buildFileRelations(...)` / `buildCallIndex(...)` are called.
- `src/index/build/file-processor/relations.js`
  - `buildFileRelations(rawRelations, relKey)`
  - `buildCallIndex(rawRelations)`
- `src/index/build/file-processor/process-chunks.js`
  - Builds per-chunk `codeRelations` from `callIndex` and writes call details; ensure filtered relations are reflected.
- `src/retrieval/output/filters.js`
  - `--calls` / `--uses` filters consume `codeRelations` and `file_relations`.
- New:
  - `src/index/build/file-processor/lexicon-relations-filter.js`

### Tasks
- [ ] Implement `filterRawRelationsWithLexicon(rawRelations, { languageId, lexicon, config, log })`.
- [ ] Apply filtering immediately before relation building:
  - In `cpu.js` inside the per-file processing flow, right after `lang.buildRelations(...)` and before `buildFileRelations` / `buildCallIndex`.
- [ ] Filtering rules:
  - `usages`: drop tokens whose normalized form is in `lexicon.stopwords.relations`.
  - `calls` / `callDetails` / `callDetailsWithRange`: drop entries if `extractSymbolBaseName(callee)` is a stopword.
  - Preserve stable ordering; dedupe only if required.
- [ ] Fail-open if lexicon missing or disabled.
- [ ] Add a per-language override mechanism (e.g., config to drop keywords/literals/builtins/types separately).
- [ ] Ensure cached bundles are compatible:
  - If cached bundles can bypass filtering, ensure incremental signature invalidation covers lexicon changes.
 - [ ] Make stable ordering a formal contract requirement (document + test).

### Tests
- [ ] `tests/file-processor/lexicon-relations-filter.test.js`
- [ ] `tests/retrieval/uses-and-calls-filters-respect-lexicon.test.js`
- [ ] `tests/file-processor/lexicon-relations-filter-ordering.test.js` (stable ordering)
- [ ] `tests/file-processor/lexicon-relations-filter-keyword-property.test.js` (JS/TS property-name edge case)
- [ ] `tests/file-processor/lexicon-relations-filter-no-imports.test.js` (imports/exports unchanged)
 - [ ] `tests/file-processor/lexicon-relations-filter-determinism.test.js`
 - [ ] `tests/file-processor/lexicon-relations-filter-perf-budget.test.js` (bounded runtime vs relation count)

---

## 11.9.3 – Retrieval-Time Lexicon-Aware Relation Boosts

### Objective
Add boost-only ranking based on calls/usages aligned with query tokens, excluding lexicon stopwords.

### Touchpoints
- `src/retrieval/pipeline.js` (scoring and explain output)
- `src/retrieval/cli/query-plan.js` (query tokens source)
- New:
  - `src/retrieval/scoring/relation-boost.js`

### Tasks
- [ ] Implement `computeRelationBoost({ chunk, fileRelations, queryTokens, lexicon, config })`.
- [ ] Wire into scoring in `src/retrieval/pipeline.js`:
  - Add `relationBoost` alongside existing boosts (symbol/phrase/etc).
  - Ensure boost-only (no filtering).
  - Provide explain payload when `--explain`.
- [ ] Gate by quality or config (default off).
- [ ] Ensure query token source uses `buildQueryPlan(...)` output (do not recompute).
- [ ] Token extraction contract:
  - Use `buildQueryPlan(...)` output from the pipeline context.
  - Respect `caseTokens` and `caseFile` when normalizing.
  - Exclude empty tokens, wildcard-only tokens, and quoted phrase delimiters.
  - Ensure deterministic token ordering and truncation rules are documented.
- [ ] Define case-folding behavior in relation to `caseTokens` and `caseFile`.
 - [ ] Add a small explain schema snippet documenting `relationBoost` fields and units.

### Tests
- [ ] `tests/retrieval/relation-boost.test.js`
- [ ] `tests/retrieval/relation-boost-does-not-filter.test.js`
- [ ] `tests/retrieval/explain-includes-relation-boost.test.js`
- [ ] `tests/retrieval/relation-boost-case-folding.test.js`
- [ ] `tests/retrieval/relation-boost-stopword-elision.test.js`
 - [ ] `tests/retrieval/relation-boost-token-source.test.js` (uses pipeline query plan tokens)

---

## 11.9.4 – Chargram Enrichment and ANN Candidate Safety

### Objective
Allow optional chargram enrichment without recall loss, and enforce candidate set safety in ANN/minhash.

### Touchpoints
- `src/shared/postings-config.js` (new `chargramFields`, `chargramStopwords`)
- `src/index/build/state.js` (chargram generation from fieldTokens)
- `src/retrieval/pipeline/candidates.js` (candidate set building)
- `src/retrieval/pipeline.js` (ANN/minhash usage)
- New:
  - `src/retrieval/scoring/ann-candidate-policy.js`

### Tasks
- [ ] Extend `normalizePostingsConfig` to support `chargramFields` + `chargramStopwords` with defaults.
- [ ] Update chargram tokenization in `appendChunk(...)` (in `src/index/build/state.js`) to use `chargramFields` and optional lexicon stopword filtering.
- [ ] Implement `resolveAnnCandidateSet(...)` and apply it to ANN and minhash candidate selection:
  - Use `annCandidateCap`, `annCandidateMinDocCount`, `annCandidateMaxDocCount`.
  - Ensure filtersActive + allowedIdx behavior is preserved.
- [ ] Emit explain payload for candidate policy decisions, with deterministic `reason` codes (`noCandidates`, `tooLarge`, `tooSmallNoFilters`, `filtersActiveAllowedIdx`, `ok`).
- [ ] Ensure ANN/minhash use the same candidate policy (no divergence).
 - [ ] Add a shared policy contract for `resolveAnnCandidateSet` and reuse in both paths.

### Tests
- [ ] `tests/postings/chargram-fields.test.js`
- [ ] `tests/retrieval/ann-candidate-policy.test.js`
- [ ] `tests/retrieval/ann-candidate-policy-explain.test.js`
- [ ] `tests/postings/chargram-stopwords.test.js` (lexicon stopword interaction)
- [ ] `tests/retrieval/ann-candidate-policy-minhash-parity.test.js`
- [ ] `tests/retrieval/ann-candidate-policy-allowedIdx.test.js`
 - [ ] `tests/retrieval/ann-candidate-policy-contract.test.js`

---

## 11.9.5 – Observability, Tuning, and Rollout

### Objective
Make filtering/boosting behavior transparent and safe to tune.

### Touchpoints
- `src/index/build/file-processor/cpu.js` (logging/counters)
- `src/retrieval/pipeline.js` (explain payload)
- `src/shared/auto-policy.js` (quality-based defaults)

### Tasks
- [ ] Emit structured per-file counts for relations filtering (calls/usages dropped).
- [ ] Add `relationBoost` + `annCandidatePolicy` to explain output.
- [ ] Gate new features behind `quality=max` by default (unless explicit config enables).
- [ ] Add a compact summary line to build logs when lexicon filtering is active (opt-in via verbose).
 - [ ] Add a “lexicon status” section to explain output when enabled (source file + version).

### Tests
- [ ] `tests/retrieval/explain-includes-relation-boost.test.js`
- [ ] `tests/retrieval/explain-includes-ann-policy.test.js`
- [ ] `tests/indexing/logging/lexicon-filter-counts.test.js` (log line shape, opt-in)

---

## Notes / Implementation Guidelines

- Prefer fail-open behavior for all lexicon-based filtering.
- Keep relation filtering conservative (keywords + literals only) unless explicitly configured per language.
- Preserve ordering; dedupe only with stable, deterministic behavior.
- Avoid new CLI flags unless required; prefer config + quality gating.
- When adding config, update docs/config schema + contract and keep drift tests passing.
- Make sure any new config keys are included in config inventory + env/config precedence docs if referenced.
 - All new lexicon behavior must be disabled by `indexing.lexicon.enabled=false`.

---

## Known Touchpoints (Function Names)

Use these function names to anchor changes:

- `processFiles(...)` in `src/index/build/indexer/steps/process-files.js` (tree-sitter deferral logic already uses ordering helpers).
- `buildFileRelations(...)` and `buildCallIndex(...)` in `src/index/build/file-processor/relations.js`.
- `createSearchPipeline(...)` in `src/retrieval/pipeline.js` (scoring + ANN candidate handling).
- `buildQueryPlan(...)` in `src/retrieval/cli/query-plan.js` (token source).
- `appendChunk(...)` in `src/index/build/state.js` (chargrams from fieldTokens).

---

## Proposed Phase Order

1. 11.9.0 – Setup + contracts (config schema + docs + lexicon schema).
2. 11.9.1 – Lexicon loader + wordlists.
3. 11.9.2 – Build-time relations filtering.
4. 11.9.4 – Chargram enrichment + ANN candidate safety (foundation for retrieval safety).
5. 11.9.3 – Retrieval relation boosts (ranking-only).
6. 11.9.5 – Observability + rollout gating.
