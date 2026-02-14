# Prose Routing and SQLite FTS Specification

## Scope
- Applies to retrieval routing in `code`, `prose`, `extracted-prose`, and `records` modes.
- Defines deterministic sparse backend routing defaults and FTS MATCH compilation behavior.

## Routing defaults
- `code` defaults to sparse/postings (`js-bm25` path).
- `prose` defaults to SQLite FTS.
- `extracted-prose` defaults to SQLite FTS.
- `records` remains sparse-only.

## Routing model contract
- Routing policy exposes desired routing and selected routing separately per mode.
- Desired routing is based on mode intent and explicit backend flags.
- Selected routing is based on availability and deterministic fallback order.
- Fallback order is fixed: `sqlite-fts` then `js-bm25`.

## Explain contract for routing
- `--explain` output includes mode routing policy in stats:
  - `stats.routingPolicy`
  - `stats.routing`
- Candidate stage diagnostics include routing reason and FTS compile metadata.
- FTS hit explain payload includes:
  - `scoreBreakdown.sparse.match`
  - `scoreBreakdown.sparse.variant`
  - `scoreBreakdown.sparse.tokenizer`
  - `scoreBreakdown.sparse.variantReason`
  - `scoreBreakdown.sparse.normalizedQueryChanged`

## FTS MATCH compilation contract
- MATCH strings are compiled from query AST when available.
- If AST compilation yields no positive literals, a validated token fallback is used.
- Literals are always quoted and escaped to prevent operator injection.
- Double quotes in literals are escaped as doubled quotes.
- Unary negation is enforced by AST filtering, not by raw unary NOT in MATCH.

## FTS tokenizer variant precedence
1. Explicit `--fts-trigram` selects `trigram`.
2. Otherwise, CJK/emoji signals or substring mode select `trigram`.
3. Otherwise, Latin script with stemming override selects `porter`.
4. Otherwise, default to `unicode61 remove_diacritics 2`.
5. If NFKC normalization changes the query text, explain includes the normalization reason suffix.

## Missing FTS table behavior
- Missing or unavailable FTS tables do not throw past provider boundaries.
- Retrieval emits controlled availability diagnostics with code `retrieval_fts_unavailable` and falls back to sparse/postings when possible.

## Retrieval helper bounds
- `rankSqliteFts` applies weighting before final top-N truncation.
- Stable tie-break is `idx` ascending when weighted scores are equal.
- Overfetch bounds are fixed defaults:
  - `overfetchRowCap = max(5000, 10 * topN)`
  - `overfetchTimeBudgetMs = 150`
