# Shared Module Review: #415

Issue: `#415`  
Scope: every file under `tools/shared/**` assigned to `#415` in the shared-module ledger.

## Overall Assessment

`tools/shared` is not one coherent family today. It contains:

1. legitimate tool-local adapters
2. generic helpers that probably belong in `src/shared`
3. thin compatibility or single-consumer shims

The main cleanup direction is to make those categories explicit so `tools/shared` stops acting as a catch-all.

## Highest-Priority Follow-Ups

- split and deprecate [`tools/shared/dict-utils.js`](C:/Users/sneak/Development/DOUBLECLEAT/tools/shared/dict-utils.js) as a broad compatibility barrel
- move [`src/shared/repo-cache-config.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/repo-cache-config.js) closer to shared cache/runtime infrastructure
- move [`tools/shared/search-request.js`](C:/Users/sneak/Development/DOUBLECLEAT/tools/shared/search-request.js) into a shared request/contract surface
- move or merge [`tools/shared/json-utils.js`](C:/Users/sneak/Development/DOUBLECLEAT/tools/shared/json-utils.js) into a generic shared JSON/IO family
- deprecate [`tools/shared/path-within-root.js`](C:/Users/sneak/Development/DOUBLECLEAT/tools/shared/path-within-root.js)
- move or deprecate [`tools/shared/search-cli-harness.js`](C:/Users/sneak/Development/DOUBLECLEAT/tools/shared/search-cli-harness.js)

## Main Findings

### Legitimate Tool-Local Adapters

- [`tools/shared/cli-display.js`](C:/Users/sneak/Development/DOUBLECLEAT/tools/shared/cli-display.js)
- [`tools/shared/cli-utils.js`](C:/Users/sneak/Development/DOUBLECLEAT/tools/shared/cli-utils.js)
- [`tools/shared/index-cli-utils.js`](C:/Users/sneak/Development/DOUBLECLEAT/tools/shared/index-cli-utils.js)
- [`tools/shared/tooling-gate-utils.js`](C:/Users/sneak/Development/DOUBLECLEAT/tools/shared/tooling-gate-utils.js)

These are reasonable `tools/shared` residents because they wrap CLI, display, and CI-gate behaviors that are tool-specific even when they depend on lower-level `src/shared` helpers.

### Modules That Are Really Cross-Surface Shared Code

- [`tools/shared/dict-utils.js`](C:/Users/sneak/Development/DOUBLECLEAT/tools/shared/dict-utils.js)
- [`tools/shared/json-utils.js`](C:/Users/sneak/Development/DOUBLECLEAT/tools/shared/json-utils.js)
- [`src/shared/repo-cache-config.js`](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/repo-cache-config.js)
- [`tools/shared/search-request.js`](C:/Users/sneak/Development/DOUBLECLEAT/tools/shared/search-request.js)

These should not stay hidden in `tools/shared` long-term because they either already have a real `src/shared` home or define behavior shared by API, MCP, retrieval, or storage runtime code.

### Thin or Weak Shared Modules

- [`tools/shared/parity-indexes.js`](C:/Users/sneak/Development/DOUBLECLEAT/tools/shared/parity-indexes.js)
- [`tools/shared/path-within-root.js`](C:/Users/sneak/Development/DOUBLECLEAT/tools/shared/path-within-root.js)
- [`tools/shared/search-cli-harness.js`](C:/Users/sneak/Development/DOUBLECLEAT/tools/shared/search-cli-harness.js)
- [`tools/shared/stats-utils.js`](C:/Users/sneak/Development/DOUBLECLEAT/tools/shared/stats-utils.js)

These are either effectively compatibility shims or only shared by one report-style caller. They should be moved closer to the owning surface or removed.

## File Ledger

| File | Classification | Review Note |
| --- | --- | --- |
| `tools/shared/cli-display.js` | `keep`, `document` | Good tool-local adapter over shared CLI display primitives. |
| `tools/shared/cli-utils.js` | `keep`, `document`, `test` | Good tool runner facade; keep lower-level subprocess semantics in `src/shared`. |
| `tools/shared/dict-utils.js` | `split`, `move`, `deprecate`, `document`, `test` | Large compatibility barrel that hides real ownership across bin, src, and tools. |
| `tools/shared/download-utils.js` | `keep`, `document`, `test` | Reasonable tool-local download policy and hash helper surface. |
| `tools/shared/fs-utils.js` | `move`, `merge`, `document`, `test` | Generic filesystem helpers that overlap with shared file primitives. |
| `tools/shared/git-state.js` | `keep`, `document`, `test` | Reasonable tool-local git metadata wrapper. |
| `tools/shared/index-cli-utils.js` | `keep`, `document`, `test` | Coherent index-CLI helper surface. |
| `tools/shared/input-parsers.js` | `keep`, `merge`, `document`, `test` | Keep tool-local, but merge tiny parsing overlap with other text/input helpers. |
| `tools/shared/json-utils.js` | `move`, `merge`, `document`, `test` | Generic JSON file helper surface that overlaps with shared IO helpers. |
| `tools/shared/parity-indexes.js` | `move`, `deprecate`, `document` | Weak shared module with one report consumer. |
| `tools/shared/path-utils.js` | `merge`, `deprecate`, `document` | Mostly alias-style wrapping over shared path logic. |
| `tools/shared/path-within-root.js` | `deprecate`, `document` | Zero-consumer one-line re-export. |
| `tools/shared/query-file-utils.js` | `keep`, `document`, `test` | Reasonable report/query tooling helper, but should stay narrow. |
| `tools/shared/search-cli-harness.js` | `move`, `deprecate`, `document`, `test` | Single-consumer report harness, not a convincing general shared module. |
| `tools/shared/search-request.js` | `move`, `document`, `test` | Shared request-building behavior should move to a canonical cross-surface contract location. |
| `tools/shared/stats-utils.js` | `deprecate`, `document` | Too small and weakly shared to remain a standalone shared module. |
| `tools/shared/text-utils.js` | `merge`, `document` | Merge this tiny comma-list helper into a broader input/text parsing surface. |
| `tools/shared/tooling-gate-utils.js` | `keep`, `document`, `test` | Good tool-local gate/reporting helper surface. |
