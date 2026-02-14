# Lexicon Relations Filtering

Status: Active  
Owner: Index Build  
Last Updated: 2026-02-14

## Purpose
Define conservative build-time filtering for noisy relations metadata before relation artifacts are written.

## Scope
- Runs after language relation extraction.
- Runs before relation indexes/artifacts are built.
- Affects only relation metadata fields.
- Does not affect sparse token postings or lexical recall.

## v1 Filter Surface
- `rawRelations.usages`
- `rawRelations.calls`
- `rawRelations.callDetails`
- `rawRelations.callDetailsWithRange`

`imports` and `exports` are not filtered in v1.

## Default Behavior
- Fail-open.
- Enabled only when `indexing.lexicon.enabled` is true and relation filtering is enabled by runtime policy.
- Default stopwords for filtering: `keywords U literals`.

## Determinism
- Preserve stable ordering.
- Do not reorder during de-dupe.
- Keep non-filtered fields untouched.

## Logging Contract
When filtering is active, emit per-file counters:
- `language`
- `file`
- `callsDropped`
- `usagesDropped`

## Versioning Rules
- Filter rules are bound to lexicon `formatVersion`.
- Explain/log payloads for filtering counters use report schema version `1`.
- Any incompatible counter-shape change must bump report schema version.
