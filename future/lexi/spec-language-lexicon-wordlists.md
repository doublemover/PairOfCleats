# Spec -- Language Lexicon Wordlists

Status: **Proposed**  
Owner: Indexing + Retrieval  
Last Updated: 2026-01-30

---

## Summary

This spec defines a standardized, versioned, per-language **lexicon wordlist** used by:

- Build-time relation post-processing (`calls`, `usages`, `callDetails`) to remove obvious noise.
- Retrieval-time ranking heuristics (boost-only) that ignore stopwords when calculating relation-based boosts.
- Optional chargram enrichment and stopword filtering (index-time) without harming recall.

The primary goal is to provide a *single source of truth* for “language surface words” (keywords, literals, builtins, primitive types, stdlib modules) that can be reused consistently across the codebase.

---

## Design Principles

1. **Fail-open:** Missing or invalid lexicon files must never break indexing or search. Fallback to `_generic.json`.
2. **Conservative defaults:** Only `keywords` and `literals` are required for v1 and are safe for filtering.
3. **Stable normalization:** All entries are stored lowercased, ASCII, unique, and (on disk) sorted.
4. **Versioned format:** Wordlists include a `formatVersion` so we can evolve the file structure.

---

## File Layout

All wordlists live in a fixed directory inside the repo/package:

- `src/lang/lexicon/wordlists/_generic.json`
- `src/lang/lexicon/wordlists/<languageId>.json`

`<languageId>` **must** match the ids used by `LANGUAGE_REGISTRY` in:

- `src/index/language-registry/registry-data.js`

Example ids (non-exhaustive): `typescript`, `python`, `go`, `clike`, `shell`, etc.

---

## JSON File Format (v1)

Each wordlist file is a JSON object with these fields:

```json
{
  "formatVersion": 1,
  "languageId": "typescript",
  "keywords": ["if", "else", "..."],
  "literals": ["true", "false", "null", "undefined"],
  "types": ["string", "number", "..."],
  "builtins": ["promise", "map", "..."],
  "modules": ["fs", "path", "..."],
  "notes": ["optional human notes"]
}
```

### Required fields

- `formatVersion` (number) — must be `1` for v1.
- `languageId` (string) — must match the filename and registry id.
- `keywords` (string[]) — lowercased.
- `literals` (string[]) — lowercased.

### Optional fields

- `types` (string[]) — primitive types and canonical type keywords for the language.
- `builtins` (string[]) — ubiquitous runtime-provided identifiers/functions/classes.
- `modules` (string[]) — standard library module/package names.
- `notes` (string[]) — freeform.

---

## Normalization Rules

Normalization applies at load time and (preferably) is also enforced on disk.

### Invariants

- All entries must be:
  - lowercased (`toLowerCase()`)
  - trimmed
  - ASCII-only (`/^[\x20-\x7E]+$/` after trim; allow spaces only if explicitly needed — v1: **no spaces**)
  - non-empty
- The loader must:
  - de-duplicate entries
  - drop falsy entries
  - tolerate missing optional fields by treating them as empty arrays

### Sorting on disk

To reduce diff noise and improve reviewability, the committed JSON arrays should be sorted lexicographically.

The loader **must not rely** on disk sorting; it should normalize regardless.

---

## Derived Stopword Sets

The lexicon loader produces derived stopword sets tailored to specific domains.

These are **derived**; they are not stored on disk.

### Domains

- `relations` — build-time relation cleanup (safe noise removal)
- `ranking` — retrieval-time boost scoring (ignore common tokens)
- `chargrams` — index-time chargram token selection (optional)

### Default derivations

Let:

- `K = keywords`
- `L = literals`
- `T = types`
- `B = builtins`

Then:

- `stopwords.relations = K ∪ L`  
  (strictly conservative; avoids filtering builtins/types by default)
- `stopwords.ranking = K ∪ L ∪ T ∪ B`  
  (ranking should not boost on language boilerplate or ubiquitous runtime names)
- `stopwords.chargrams = K ∪ L`  
  (optional; if you include signature/comment fields, consider extending to include `T ∪ B`)

---

## Loader Contract

Recommended public surface:

- `getLanguageLexicon(languageId: string | null): LanguageLexicon`
- `isStopword(languageId: string | null, token: string, domain: 'relations'|'ranking'|'chargrams'): boolean`

### `LanguageLexicon` shape

```ts
type LanguageLexicon = {
  formatVersion: 1,
  languageId: string,
  keywords: Set<string>,
  literals: Set<string>,
  types: Set<string>,
  builtins: Set<string>,
  modules: Set<string>,
  stopwords: {
    relations: Set<string>,
    ranking: Set<string>,
    chargrams: Set<string>
  }
}
```

### Caching

- Cache by `languageId` in a module-level `Map`.
- Load and normalize each language at most once per process.

### Fallback rules

- If `languageId` is null/unknown -> `_generic`
- If the specific file is missing -> `_generic`
- If file exists but schema is invalid -> `_generic` (log once)

---

## Validation

The repository includes:

- `language-lexicon-wordlist.schema.json`

Validation expectations:

- Every file in `src/lang/lexicon/wordlists/*.json` must validate.
- A test should enumerate `LANGUAGE_REGISTRY` ids and verify a lexicon exists for each.

---

## Security / Safety Notes

- Lexicon files are local, trusted assets shipped with the tool.
- Any optional “external lexicon path” must be treated as user input:
  - validate schema
  - fail-open
  - never execute code

---

## Test Plan

### Unit: schema + normalization

- Load every lexicon json file.
- Validate against the schema.
- Assert:
  - lowercase only
  - uniqueness
  - required arrays exist

### Unit: fallback

- `getLanguageLexicon('__does_not_exist__')` returns `_generic`.

### Unit: derivations

- Given a small lexicon, ensure derived stopwords match the union rules above.

---

## Open Questions

- Should v2 support non-ASCII identifiers (e.g., in some language keywords)? v1 forbids it for simplicity.
- Should the lexicon include “soft stopwords” vs “hard stopwords”? v1 assumes all `keywords` are safe stopwords for relations, but languages like JavaScript allow keywords as property names. The filtering spec addresses this conservatively (default only filters obvious noise + literals; keywords list for JS should include only those we’re comfortable filtering).

