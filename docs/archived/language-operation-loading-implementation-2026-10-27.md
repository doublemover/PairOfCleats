# Demanded language operation loading — 2026-10-27

Source `154d7ba6bae752fe6d5210fe7000bf725f4260aa`, tree
`6cf785a6b143c5abbfbfa11a40a227e777cfa14f`, branch
`codex/pr557-audit-repairs-20261012`. Functional execution is deferred.

Concrete registry construction and chunker dispatch now capture literal module
loaders; actual operation calls initialize the selected module and cache its
function. The synchronous public APIs retain synchronous results, while existing
async operations retain their Promises. Load/initialization/operation failures
propagate without parser/backend fallback or empty-result substitution. Adapter
identity, capability methods, arguments and existing prepare/dispatch ordering
remain. Conditional Tree-sitter owners initialize their generic parser graph only
when the existing requested operation needs it. Plain prose fallback and ordinary
Markdown do not initialize code parsers.

Static relative ESM import/reexport analysis, before/after this checkpoint:

| Entry | Repository modules before → after | Language-family modules before → after |
| --- | --- | --- |
| `src/index/chunking.js` | 221 → 11 | 67 → 0 |
| `src/index/language-registry.js` | 263 → 76 | 68 → 0 |

Neither resulting static closure reaches external code-parser packages. No
top-level await was found in the analyzed repository closures. This is source
graph analysis, not measured runtime import counts, vendor lifecycle qualification
or a startup/RSS/latency result. Node 26 synchronous ESM loading requires a
synchronous module graph; future asynchronous initialization needs an explicit
async preparation owner.

AST comparison (excluding import/load declarations and source positions) proved
all seven edited dispatch/adapter operation bodies unchanged. Main normalized
body SHA-256 values are `b7b1c0bb1e950e13ed674029522e54b0dd0386bfaa5cc2ebe1b8141fc5e765aa`
(registry data), `eb4456cafed6dc217f3d7b5e74cb5a04ae5018cbf29939e8a7c0849cdd89e74c`
(registry operations) and `99749602f9ea1eaf4fde3ee457f778ca6d64b8f166d2f531bbaba6c26e6e86b0`
(chunk dispatch). Original full analysis outputs under author-workspace
`.tmp/tasks/language-loading-20261027/` are historical local receipts, not clean
checkout dependencies. No producer meaning changed, so semantic versions remain.

Six fresh-process guards are authored, **unexecuted**: cold concrete registry,
prose context/Markdown/fallback, actual JS/TS/config imports and requested load
failure. They retain positive source imports, negative comment/string controls,
warm content parity, synchronous results and exact load-error propagation. The
four prior metadata-only guards and actual adapter parity remain.

Format/ESLint, changed-JavaScript syntax, config budget, script inventory and
whitespace checks passed. No project functional fixture ran. #1607 remains open
for complete worker/entry-point initialization, actual consumer/native/import-
budget parity and resource/performance qualification. See the
[routing contract](../contracts/language-routing-metadata.md).
