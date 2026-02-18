# Language Lexicon Wordlists

Status: Active  
Owner: Indexing + Retrieval  
Last Updated: 2026-02-14

## Purpose
Define the canonical per-language lexicon format used by build-time relation filtering, retrieval relation boosts, and optional chargram stopword filtering.

## File Layout
- `src/lang/lexicon/language-lexicon-wordlist.schema.json`
- `src/lang/lexicon/wordlists/_generic.json`
- `src/lang/lexicon/wordlists/<languageId>.json`

`<languageId>` must match the language registry id when a language-specific file exists.

## Schema (v1)
Required fields:
- `formatVersion` (must be `1`)
- `languageId`
- `keywords[]`
- `literals[]`

Optional fields:
- `types[]`
- `builtins[]`
- `modules[]`
- `notes[]`

Additional properties are disallowed.

## Normalization Rules
- ASCII only in v1.
- Lowercase.
- Trimmed.
- Unique.
- No empty tokens.

## Derived Domain Sets
- `relations`: `keywords U literals`
- `ranking`: `keywords U literals U types U builtins`
- `chargrams`: `keywords U literals`

## Versioning Rules
- Wordlist payloads are versioned by `formatVersion`.
- v1 contracts are backward-compatible for additive token updates.
- Any schema-shape change requires `formatVersion` bump and loader fallback path.

## v2 Deferral
Non-ASCII lexicon tokens are intentionally deferred to v2. v1 remains ASCII-only for deterministic cross-platform normalization.
