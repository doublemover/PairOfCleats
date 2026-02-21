# Language Descriptor Contract

## Purpose

Define the canonical descriptor source used for language routing and special-file dispatch across indexing discovery and registry resolution.

## Canonical source

- `src/index/language-registry/descriptors.js`

This is the only file that should define language routing descriptors (`id`, `extensions`, `specialFilenames`, `specialPrefixes`, `parserRoute`, `adapterId`, `capsProfile`).

## Related generated/derived tables

The following tables must be derived from canonical descriptor sources rather than duplicated manually:

- Extension routing and language dispatch maps in `src/index/language-registry/registry.js`.
- Extension sets in `src/index/constants.js` used by discovery/watcher paths.
- Special-code filename maps in `src/index/language-registry/special-files.js` and `src/index/constants.js`.

## Contract fields

Each descriptor row must define:

1. `id`: canonical language id used by `LANGUAGE_REGISTRY`.
2. `adapterId`: adapter binding identifier (normally equal to `id`).
3. `parserRoute`: declared parser/chunker route.
4. `capsProfile`: language-specific caps profile id.
5. `extensions`: normalized lowercase extension array.
6. `specialFilenames`: optional exact basename routes.
7. `specialPrefixes`: optional basename-prefix routes.

## Invariants

1. Every descriptor `id` must resolve to a live adapter entry in `src/index/language-registry/registry-data.js`.
2. Descriptor extension and special-file maps must produce deterministic routing without fallback ambiguity for known routes.
3. Changes to descriptors must include parity test updates in `tests/indexing/language-registry/*`.