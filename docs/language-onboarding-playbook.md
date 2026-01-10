# Language onboarding playbook

Use this checklist when adding a new language or container format.

## Decide parsing strategy
- Prefer tree-sitter (WASM) when a stable grammar exists.
- Use heuristics when the grammar is unstable or not needed.
- Consider tool-only enrichment (LSP, external tooling) if parsing is expensive.

## Implement core support
1) Extensions + language IDs
   - Add extensions and special filenames in `src/index/constants.js`.
   - Add markdown fence aliases + language ID mapping in `src/index/segments.js`.
2) Chunk extraction
   - Add chunkers in `src/index/chunking.js` (tree-sitter or heuristic).
3) Minimal relations
   - Add import collection in `src/index/language-registry.js`.
   - Use `buildSimpleRelations` for import-only languages.
4) Comment extraction rules
   - Add comment styles + extension overrides in `src/index/comments.js`.
5) Metadata v2 mapping
   - Ensure `extractDocMeta` returns a stable shape (even `{}`) in `src/index/language-registry.js`.

## Tests and guardrails
- Add fixtures under `tests/fixtures/languages/src/`.
- Extend `tests/language-fidelity.js` to assert chunk coverage.
- Add perf guard tests (max bytes/lines) when parsing or relations are expensive.

## Benchmarks
- Add a query file under `benchmarks/queries/`.
- Add an entry to `benchmarks/repos.json` with at least a `typical` list (empty is OK).

## Validation
- Run `node tests/language-fidelity.js` (or `npm run language-fidelity-test`).
- Run `npm run bench-language -- --list` to confirm the matrix entry appears.
