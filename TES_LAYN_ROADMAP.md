# TES_LAYN_ROADMAP — Full‑Coverage Language Lane Overhaul (Ultra‑Expanded)

Purpose: build a **comprehensive, deterministic** test lane that validates full indexing coverage **per supported language**, including AST, control/data flow, relations/graphs, risk pack, and API boundary behavior. This is a long‑term contract: adding or changing a language should immediately surface test gaps.

Supported language IDs (from `src/index/language-registry/registry-data.js`):
`javascript`, `typescript`, `python`, `clike`, `go`, `java`, `csharp`, `kotlin`, `ruby`, `php`, `html`, `css`, `lua`, `sql`, `perl`, `shell`, `rust`, `swift`, `cmake`, `starlark`, `nix`, `dart`, `scala`, `groovy`, `r`, `julia`, `handlebars`, `mustache`, `jinja`, `razor`, `proto`, `makefile`, `dockerfile`, `graphql`.

Framework variants explicitly covered:
- **React** (JSX/TSX) under `javascript`/`typescript` fixtures.
- **Vue** (SFC `.vue`) under `javascript`/`typescript` fixtures with segment extraction.

How to use this roadmap:
- **Phases 0–9** describe implementation order and cross‑cutting work.
- **Inline per‑language tables** under each phase list the work required for each language in that phase.
- **Appendix B**: per‑language unique constructs and fixture semantics.
- **Appendix C**: per‑language per‑artifact sub‑checks (deep, field‑level expectations).
- **Appendix D**: per‑language minimum counts (authoritative thresholds).
- **Appendix D2**: per‑language presence/absence matrix (authoritative for artifact existence).
- **Appendix E**: subsystem matrix (goals, edge cases, tests).
- **Appendices F–O**: execution aids (fixtures, schema versions, negatives, goldens, perf, mixed repo, ordering, toggles).

Appendix D2 is encoded in `tests/lang/matrix/lang-artifact-presence.json` and must remain in sync with this document.

Conventions:
- If an artifact is optional for a language, tests must assert **absent/empty** per Appendix D2.
- Counts in Appendix D are **minimums**; update them alongside fixtures.
- Language order in tables follows `registry-data.js` for stable diffs.

---

## Execution policy (budgets, sharding, skips, triage)

### Runtime budgets (per lane)
- `lang-full` lane target: <= 30 minutes on CI, <= 15 minutes locally on a modern dev laptop.
- Per-shard target: <= 10 minutes on CI, <= 5 minutes locally.
- Per-test target: <= 30 seconds (aligns with repo test policy; auto-cancel beyond 30s).

### Sharding strategy
- Deterministic sharding by language ID list in `registry-data.js`.
- Shard manifest files (checked in) define the exact ordered test list per shard.
- Shard count is configurable via env (`LANG_FULL_SHARD_COUNT`), and shards are selected by index (`LANG_FULL_SHARD_INDEX`).
- Sharding must preserve per-language ordering within a shard to keep diffs stable.

### Fixture generation strategy
- Fixtures are curated and checked in; avoid network dependencies in tests.
- Any auto-generated fixtures must have a committed generator script and a fixed seed.
- Fixture updates must include a changelog entry in `tests/fixtures/README.md` describing intent.

### Skip rules
- Missing optional tools (clangd, sourcekit-lsp, gtags, ctags, lsif/scip) may skip only the tool-specific subset, not the entire lane.
- Skips must include a reason code and the missing tool/version in test output.
- Skips are not allowed for core indexing artifacts (chunks, imports, relations, risk summaries).

### Failure triage checklist
- Classify failures as: fixture regression, tool/runtime dependency, schema drift, performance regression.
- Capture: failing test name, shard id, tool versions, and the affected artifacts list.
- Provide a minimal reproduction command in the test log.

---

## Phase 0 — Foundations: matrix + contracts (single source of truth)

**References**: Appendix B (constructs), Appendix F (fixture inventories), Appendix G (schema versions)

### 0.1 Matrix definition and guardrails

**Goals**
- Single authoritative capability matrix.
- Deterministic fixture mapping per language.

**Non‑goals**
- Implementing new language features.

**Specs to add/update**
- `docs/contracts/indexing.md` add a “Language capability matrix” section pointing to matrix JSON.
- `docs/specs/language-registry.md` (new) to define matrix semantics.

**Tasks**
- [ ] Create `tests/lang/matrix/lang-capabilities.json` with per‑language flags:
  - `imports`, `relations`, `docmeta`, `treeSitter`, `ast`, `controlFlow`, `dataFlow`, `graphRelations`, `riskLocal`, `riskInterprocedural`, `symbolGraph`.
  - Add `frameworks` array (e.g., `react`, `vue`) for JS/TS.
- [ ] Create `tests/lang/matrix/lang-fixtures.json` mapping language → fixture directory + main files.
- [ ] Create `tests/lang/matrix/lang-expectations.json` for expected minimum counts (chunks/imports/relations) per language.
- [ ] Create `tests/lang/matrix/lang-artifact-presence.json` to encode Appendix D2 (required/optional/absent artifacts per language).
- [ ] Add `tests/lang/matrix/lang-matrix-completeness.test.js`:
  - verify every registry language ID appears in all 4 JSON files.
  - verify JSON schema (required keys, no unknown keys).

**Per-language tasks**: see Section 0.A (per‑language subphases). Apply Appendix B/F for language‑unique fixture + expectation details.

**Touchpoints**
- `src/index/language-registry/registry-data.js`
- `tests/lang/matrix/**`
- `docs/contracts/indexing.md`

**Tests**
- `tests/lang/matrix/lang-matrix-completeness.test.js`

---

### 0.2 Registry/Matrix drift checks

**Goals**
- Prevent silent drift between registry and matrix.

**Tasks**
- [ ] Add `tests/lang/matrix/lang-matrix-drift.test.js`:
  - diff registry list vs matrix list.
  - fails if registry adds language without matrix entry.
- [ ] Add `tools/lang/matrix-audit.js` to emit a report of missing/extra entries.

**Per-language tasks**: see Section 0.A; confirm drift checks enumerate every language entry.

**Tests**
- `tests/lang/matrix/lang-matrix-drift.test.js`

### 0.A Per-language subphases (inline)

| Language | Tasks |
| --- | --- |
| javascript | Matrix flags + fixtures + expectations (Appendix B.1) |
| typescript | Matrix flags + fixtures + expectations (Appendix B.2) |
| python | Matrix flags + fixtures + expectations (Appendix B.3) |
| clike | Matrix flags + fixtures + expectations (Appendix B.4) |
| go | Matrix flags + fixtures + expectations (Appendix B.5) |
| java | Matrix flags + fixtures + expectations (Appendix B.6) |
| csharp | Matrix flags + fixtures + expectations (Appendix B.7) |
| kotlin | Matrix flags + fixtures + expectations (Appendix B.8) |
| ruby | Matrix flags + fixtures + expectations (Appendix B.9) |
| php | Matrix flags + fixtures + expectations (Appendix B.10) |
| html | Matrix flags + fixtures + expectations (Appendix B.11) |
| css | Matrix flags + fixtures + expectations (Appendix B.12) |
| lua | Matrix flags + fixtures + expectations (Appendix B.13) |
| sql | Matrix flags + fixtures + expectations (Appendix B.14) |
| perl | Matrix flags + fixtures + expectations (Appendix B.15) |
| shell | Matrix flags + fixtures + expectations (Appendix B.16) |
| rust | Matrix flags + fixtures + expectations (Appendix B.17) |
| swift | Matrix flags + fixtures + expectations (Appendix B.18) |
| cmake | Matrix flags + fixtures + expectations (Appendix B.19) |
| starlark | Matrix flags + fixtures + expectations (Appendix B.20) |
| nix | Matrix flags + fixtures + expectations (Appendix B.21) |
| dart | Matrix flags + fixtures + expectations (Appendix B.22) |
| scala | Matrix flags + fixtures + expectations (Appendix B.23) |
| groovy | Matrix flags + fixtures + expectations (Appendix B.24) |
| r | Matrix flags + fixtures + expectations (Appendix B.25) |
| julia | Matrix flags + fixtures + expectations (Appendix B.26) |
| handlebars | Matrix flags + fixtures + expectations (Appendix B.27) |
| mustache | Matrix flags + fixtures + expectations (Appendix B.28) |
| jinja | Matrix flags + fixtures + expectations (Appendix B.29) |
| razor | Matrix flags + fixtures + expectations (Appendix B.30) |
| proto | Matrix flags + fixtures + expectations (Appendix B.31) |
| makefile | Matrix flags + fixtures + expectations (Appendix B.32) |
| dockerfile | Matrix flags + fixtures + expectations (Appendix B.33) |
| graphql | Matrix flags + fixtures + expectations (Appendix B.34) |

---

## Phase 1 — Lane creation + deterministic ordering

**References**: Appendix N (ordering contracts), Appendix P (per‑language tables)

### 1.1 Lane definition and ordering

**Goals**
- Dedicated `lang-full` lane with stable order.

**Tasks**
- [ ] Add lane to `tests/run.js`, `tests/run.rules.jsonc`, `tests/run.config.jsonc`.
- [ ] Create `tests/lang-full/lang-full.order.txt` ordered by language and by capability.
- [ ] Add sharding support using `LANG_FULL_SHARD_INDEX`/`LANG_FULL_SHARD_COUNT` and shard manifests derived from `lang-full.order.txt`.
- [ ] Add lane description to `docs/guides/commands.md`.

**Touchpoints**
- `tests/run.js` (~L1-L487)
- `tests/run.rules.jsonc` (~L1-L139)
- `tests/run.config.jsonc` (~L1-L14)
- `tests/lang-full/lang-full.order.txt` (new)
- `tests/lang-full/lang-full.order.json` (new)
- `tests/lang-full/shards/*.txt` (new)
- `docs/guides/commands.md` (~L1-L165)

**Per-language tasks**: see Section 1.A; ensure ordering entry exists for every language.

**Tests**
- `tests/runner/lane-ordering-lang-full.test.js`

---

### 1.A Per-language subphases (inline)

| Language | Tasks |
| --- | --- |
| javascript | Add lang-full ordering entry; ensure JS block ordering |
| typescript | Add lang-full ordering entry; ensure TS block ordering |
| python | Add lang-full ordering entry; ensure Python block ordering |
| clike | Add lang-full ordering entry; ensure C/C++ block ordering |
| go | Add lang-full ordering entry; ensure Go block ordering |
| java | Add lang-full ordering entry; ensure Java block ordering |
| csharp | Add lang-full ordering entry; ensure CSharp block ordering |
| kotlin | Add lang-full ordering entry; ensure Kotlin block ordering |
| ruby | Add lang-full ordering entry; ensure Ruby block ordering |
| php | Add lang-full ordering entry; ensure PHP block ordering |
| html | Add lang-full ordering entry; ensure HTML block ordering |
| css | Add lang-full ordering entry; ensure CSS block ordering |
| lua | Add lang-full ordering entry; ensure Lua block ordering |
| sql | Add lang-full ordering entry; ensure SQL block ordering |
| perl | Add lang-full ordering entry; ensure Perl block ordering |
| shell | Add lang-full ordering entry; ensure Shell block ordering |
| rust | Add lang-full ordering entry; ensure Rust block ordering |
| swift | Add lang-full ordering entry; ensure Swift block ordering |
| cmake | Add lang-full ordering entry; ensure CMake block ordering |
| starlark | Add lang-full ordering entry; ensure Starlark block ordering |
| nix | Add lang-full ordering entry; ensure Nix block ordering |
| dart | Add lang-full ordering entry; ensure Dart block ordering |
| scala | Add lang-full ordering entry; ensure Scala block ordering |
| groovy | Add lang-full ordering entry; ensure Groovy block ordering |
| r | Add lang-full ordering entry; ensure R block ordering |
| julia | Add lang-full ordering entry; ensure Julia block ordering |
| handlebars | Add lang-full ordering entry; ensure Handlebars block ordering |
| mustache | Add lang-full ordering entry; ensure Mustache block ordering |
| jinja | Add lang-full ordering entry; ensure Jinja block ordering |
| razor | Add lang-full ordering entry; ensure Razor block ordering |
| proto | Add lang-full ordering entry; ensure Proto block ordering |
| makefile | Add lang-full ordering entry; ensure Makefile block ordering |
| dockerfile | Add lang-full ordering entry; ensure Dockerfile block ordering |
| graphql | Add lang-full ordering entry; ensure GraphQL block ordering |

---

## Phase 2 — Fixtures + indexing contract per language

**References**: Appendix B (constructs), Appendix F (fixture inventories), Appendix D (minimum counts), Appendix D2 (artifact presence)

### 2.1 Fixture baseline per language

**Tasks**
- [ ] Ensure a fixture exists under `tests/fixtures/languages/<id>/` with:
  - ≥2 files
  - ≥1 import
  - ≥1 symbol definition + usage
  - language‑specific constructs (see per‑language checklists below)

**Per-language tasks**: see Section 2.A for fixture requirements per language.

### 2.2 Fixture sanity tests (data‑driven)

**Tasks**
- [ ] Implement `tests/lang/<id>/fixture-sanity.test.js` via harness.

**Touchpoints**
- `tests/fixtures/languages/<id>/**` (new/expanded)
- `tests/fixtures/README.md` (new)
- `tests/lang/<id>/fixture-sanity.test.js` (new)
- `tests/lang/fixtures/<id>/fixture-inventory.json` (new)
- `tests/lang/harness/fixtures.js` (new)
- `tests/lang/harness/expectations.js` (new)
- `tests/lang/matrix/lang-fixtures.json` (new)

**Per-language tasks**: see Section 2.A; add fixture‑sanity test per language and bind to fixture inventory (Appendix F).

### 2.A Per-language subphases (inline)

| Language | Tasks |
| --- | --- |
| javascript | Fixtures with ESM + CJS + React JSX (Appendix B.1) |
| typescript | Fixtures with TSX + generics + types (Appendix B.2) |
| python | Fixtures with decorators + async (Appendix B.3) |
| clike | Fixtures with includes + macros (Appendix B.4) |
| go | Fixtures with goroutines + interfaces (Appendix B.5) |
| java | Fixtures with classes + lambdas (Appendix B.6) |
| csharp | Fixtures with attributes + async (Appendix B.7) |
| kotlin | Fixtures with data class + extensions (Appendix B.8) |
| ruby | Fixtures with modules + blocks (Appendix B.9) |
| php | Fixtures with traits + namespaces (Appendix B.10) |
| html | Fixtures with DOM + script/style tags (Appendix B.11) |
| css | Fixtures with selectors + @media (Appendix B.12) |
| lua | Fixtures with tables + require (Appendix B.13) |
| sql | Fixtures with DDL + CTE (Appendix B.14) |
| perl | Fixtures with packages + regex (Appendix B.15) |
| shell | Fixtures with source + pipes (Appendix B.16) |
| rust | Fixtures with traits + lifetimes (Appendix B.17) |
| swift | Fixtures with protocols + extensions (Appendix B.18) |
| cmake | Fixtures with include + add_executable (Appendix B.19) |
| starlark | Fixtures with load + rule (Appendix B.20) |
| nix | Fixtures with import + let/in (Appendix B.21) |
| dart | Fixtures with async + class (Appendix B.22) |
| scala | Fixtures with object + trait (Appendix B.23) |
| groovy | Fixtures with closures + class (Appendix B.24) |
| r | Fixtures with library + function (Appendix B.25) |
| julia | Fixtures with using + module (Appendix B.26) |
| handlebars | Fixtures with partials + helpers (Appendix B.27) |
| mustache | Fixtures with sections + vars (Appendix B.28) |
| jinja | Fixtures with blocks + include (Appendix B.29) |
| razor | Fixtures with directives + inline code (Appendix B.30) |
| proto | Fixtures with messages + services (Appendix B.31) |
| makefile | Fixtures with include + target (Appendix B.32) |
| dockerfile | Fixtures with FROM + RUN + COPY (Appendix B.33) |
| graphql | Fixtures with types + queries (Appendix B.34) |

---

## Phase 3 — AST + control/data flow coverage

**References**: Appendix C (per‑artifact sub‑checks), Appendix E (subsystem matrix)

**Touchpoints**
- `tests/lang/<id>/ast-flow.test.js` (new)
- `tests/lang/harness/expectations.js` (new)
- `tests/lang/goldens/<id>/<artifact>.json` (new)
- `tests/lang/determinism-matrix.test.js` (new)

### 3.1 AST extraction validation

**Tasks**
- [ ] Add `tests/lang/<id>/ast-flow.test.js` for `ast` languages.

**Per-language tasks**: see Section 3.A; assert AST nodes per language and handle non‑AST languages via negative checks.

### 3.2 Control/data flow validation

**Tasks**
- [ ] Extend flow assertions for control‑flow and data‑flow.

**Per-language tasks**: see Section 3.A; validate control/data flow per language where supported.

### 3.A Per-language subphases (inline)

| Language | Tasks |
| --- | --- |
| javascript | AST/flow for JSX + generators; assert counts |
| typescript | AST/flow for TSX + types; assert counts |
| python | AST/flow for decorators + async |
| clike | AST/flow for structs + templates |
| go | AST/flow for goroutines |
| java | AST/flow for lambdas |
| csharp | AST/flow for attributes + async |
| kotlin | AST/flow for data classes |
| ruby | AST/flow for blocks |
| php | AST/flow for traits |
| html | Assert no AST; negative checks |
| css | Assert no AST; negative checks |
| lua | AST/flow for functions |
| sql | AST/flow for statements if supported; else negative |
| perl | AST/flow for subs |
| shell | AST/flow for functions |
| rust | AST/flow for traits + impls |
| swift | AST/flow for protocols |
| cmake | AST minimal; chunking stable |
| starlark | AST for load/rule if supported |
| nix | AST for let/in if supported |
| dart | AST/flow for async |
| scala | AST/flow for trait/object |
| groovy | AST/flow for closure |
| r | AST minimal; chunking |
| julia | AST minimal; chunking |
| handlebars | no AST; template chunking |
| mustache | no AST; template chunking |
| jinja | no AST; template chunking |
| razor | no AST; template chunking |
| proto | AST for message/service if supported |
| makefile | AST minimal; chunking |
| dockerfile | AST minimal; chunking |
| graphql | AST for schema if supported |

---

## Phase 4 — Relations + graph artifacts

**References**: Appendix C (per‑artifact sub‑checks), Appendix D2 (artifact presence)

**Touchpoints**
- `tests/lang/<id>/relations.test.js` (new)
- `tests/lang/<id>/symbol-graph.test.js` (new)
- `tests/lang/goldens/<id>/graph_relations*.json` (new)
- `tests/lang/harness/expectations.js` (new)

### 4.1 Relations coverage

**Tasks**
- [ ] Add `tests/lang/<id>/relations.test.js` for languages with relations.

**Per-language tasks**: see Section 4.A; validate relations presence or absence per language.

### 4.2 Symbol graph artifacts

**Tasks**
- [ ] Add `tests/lang/<id>/symbol-graph.test.js`.

**Per-language tasks**: see Section 4.A; ensure symbol graph present for symbol‑supported languages.

### 4.A Per-language subphases (inline)

| Language | Tasks |
| --- | --- |
| javascript | import/require edges + symbol graph |
| typescript | import type edges + symbol graph |
| python | import/from edges |
| clike | include edges |
| go | import edges |
| java | import edges |
| csharp | using edges |
| kotlin | import edges |
| ruby | require edges |
| php | use edges |
| html | assert absent relations |
| css | assert absent relations |
| lua | require edges |
| sql | optional relations; validate empties |
| perl | use edges |
| shell | source edges |
| rust | use edges + symbol graph |
| swift | import edges |
| cmake | include edges |
| starlark | load edges |
| nix | import edges |
| dart | import edges |
| scala | import edges |
| groovy | import edges |
| r | library edges optional |
| julia | using/import edges |
| handlebars | assert absent relations |
| mustache | assert absent relations |
| jinja | assert absent relations |
| razor | assert absent relations |
| proto | import edges |
| makefile | include edges |
| dockerfile | assert absent relations |
| graphql | assert absent relations |

---

## Phase 5 — Risk pack + interprocedural gating

**References**: Appendix C (risk sub‑checks), Appendix D2 (artifact presence)

**Touchpoints**
- `tests/lang/<id>/risk-local.test.js` (new)
- `tests/lang/risk-interprocedural-matrix.test.js` (new)
- `tests/lang/goldens/<id>/risk_*.json` (new)
- `tests/lang/harness/expectations.js` (new)

### 5.1 Local risk

**Tasks**
- [ ] Add `tests/lang/<id>/risk-local.test.js`.

**Per-language tasks**: see Section 5.A; assert local risk outputs or explicit absence.

### 5.2 Interprocedural risk matrix

**Tasks**
- [ ] Add `tests/lang/risk-interprocedural-matrix.test.js`.

**Per-language tasks**: see Section 5.A; assert interprocedural stats when enabled.

### 5.A Per-language subphases (inline)

| Language | Tasks |
| --- | --- |
| javascript | local risk eval/dynamic import; interproc if enabled |
| typescript | local risk eval/dynamic import; interproc if enabled |
| python | local risk eval/exec/subprocess |
| clike | local risk system/strcpy |
| go | local risk os/exec |
| java | local risk Runtime.exec |
| csharp | local risk Process.Start |
| kotlin | local risk if supported; else absent |
| ruby | local risk if supported; else absent |
| php | local risk if supported; else absent |
| html | assert risk artifacts absent |
| css | assert risk artifacts absent |
| lua | local risk if supported; else absent |
| sql | assert risk artifacts absent |
| perl | local risk if supported; else absent |
| shell | local risk exec patterns |
| rust | local risk unsafe/exec |
| swift | local risk if supported; else absent |
| cmake | assert risk artifacts absent |
| starlark | assert risk artifacts absent |
| nix | assert risk artifacts absent |
| dart | local risk if supported; else absent |
| scala | local risk if supported; else absent |
| groovy | local risk if supported; else absent |
| r | assert risk artifacts absent |
| julia | assert risk artifacts absent |
| handlebars | assert risk artifacts absent |
| mustache | assert risk artifacts absent |
| jinja | assert risk artifacts absent |
| razor | assert risk artifacts absent |
| proto | assert risk artifacts absent |
| makefile | assert risk artifacts absent |
| dockerfile | assert risk artifacts absent |
| graphql | assert risk artifacts absent |

---

## Phase 6 — API boundary + search/filters

**References**: Appendix E (API boundary), Appendix B (language constructs)

**Touchpoints**
- `tests/lang/<id>/search-filters.test.js` (new)
- `tests/lang/api/search-language.test.js` (new)
- `src/retrieval/filters.js` (~L1-L294)
- `src/retrieval/cli-args.js` (~L1-L193)

### 6.1 CLI search filters per language

**Tasks**
- [ ] Add `tests/lang/<id>/search-filters.test.js`.

**Per-language tasks**: see Section 6.A; validate search filters per language.

### 6.2 API search parity

**Tasks**
- [ ] Add `tests/lang/api/search-language.test.js`.

**Per-language tasks**: see Section 6.A; validate API parity per language.

### 6.A Per-language subphases (inline)

| Language | Tasks |
| --- | --- |
| javascript | search filters for JSX/React; API parity |
| typescript | search filters for TSX/types; API parity |
| python | search filters for defs/imports |
| clike | search filters for includes/symbols |
| go | search filters for funcs/types |
| java | search filters for classes/methods |
| csharp | search filters for classes/attributes |
| kotlin | search filters for classes/functions |
| ruby | search filters for modules/methods |
| php | search filters for classes/functions |
| html | search filters for tags/attrs |
| css | search filters for selectors |
| lua | search filters for functions |
| sql | search filters for tables/queries |
| perl | search filters for subs |
| shell | search filters for scripts |
| rust | search filters for traits/impls |
| swift | search filters for types/functions |
| cmake | search filters for targets |
| starlark | search filters for rules |
| nix | search filters for attrs |
| dart | search filters for classes/functions |
| scala | search filters for traits/objects |
| groovy | search filters for classes/closures |
| r | search filters for functions |
| julia | search filters for functions |
| handlebars | search filters for templates |
| mustache | search filters for templates |
| jinja | search filters for templates |
| razor | search filters for templates |
| proto | search filters for messages/services |
| makefile | search filters for targets |
| dockerfile | search filters for instructions |
| graphql | search filters for types/queries |

---

## Phase 7 — Determinism + regression suite

**References**: Appendix D (minimum counts), Appendix D2 (artifact presence)

**Touchpoints**
- `tests/lang/<id>/determinism.test.js` (new)
- `tests/lang/determinism-matrix.test.js` (new)
- `tests/lang/goldens/<id>/**` (new)
- `tests/lang/harness/expectations.js` (new)

### 7.1 Determinism per language

**Tasks**
- [ ] Add `tests/lang/<id>/determinism.test.js`.

**Per-language tasks**: see Section 7.A; ensure deterministic outputs per language.

### 7.2 Matrix determinism validation

**Tasks**
- [ ] Add `tests/lang/determinism-matrix.test.js`.

**Per-language tasks**: see Section 7.A; validate matrix determinism per language.

### 7.A Per-language subphases (inline)

| Language | Tasks |
| --- | --- |
| javascript | determinism test for JSX/React artifacts |
| typescript | determinism test for TSX/type artifacts |
| python | determinism test for imports/symbols |
| clike | determinism test for includes/symbols |
| go | determinism test for imports/symbols |
| java | determinism test for imports/symbols |
| csharp | determinism test for imports/symbols |
| kotlin | determinism test for imports/symbols |
| ruby | determinism test for relations |
| php | determinism test for relations |
| html | determinism test for docmeta |
| css | determinism test for docmeta |
| lua | determinism test for relations |
| sql | determinism test for docmeta |
| perl | determinism test for relations |
| shell | determinism test for relations |
| rust | determinism test for symbols |
| swift | determinism test for relations |
| cmake | determinism test for includes |
| starlark | determinism test for load edges |
| nix | determinism test for imports |
| dart | determinism test for relations |
| scala | determinism test for relations |
| groovy | determinism test for relations |
| r | determinism test for docmeta |
| julia | determinism test for docmeta |
| handlebars | determinism test for templates |
| mustache | determinism test for templates |
| jinja | determinism test for templates |
| razor | determinism test for templates |
| proto | determinism test for messages |
| makefile | determinism test for includes |
| dockerfile | determinism test for instructions |
| graphql | determinism test for schema |

---

## Phase 8 — CI wiring + reporting

**References**: Appendix M (roadmap tags), Appendix N (ordering)

**Touchpoints**
- `.github/workflows/ci.yml` (new lane wiring)
- `tests/run.js` (~L1-L487)
- `tests/run.rules.jsonc` (~L1-L139)
- `docs/tooling/lang-matrix-report.json` (new)
- `docs/guides/commands.md` (~L1-L165)
- `docs/contracts/indexing.md` (~L1-L90)

### 8.1 CI integration

**Tasks**
- [ ] Add `lang-full` lane to CI workflows.
- [ ] Add CI output artifact: `docs/tooling/lang-matrix-report.json`.

**Per-language tasks**: see Section 8.A; ensure each language appears in CI report outputs.

### 8.2 Documentation updates

**Tasks**
- [ ] Add `lang-full` lane to `docs/guides/commands.md`.
- [ ] Add matrix reference to `docs/contracts/indexing.md`.

**Per-language tasks**: see Section 8.A; confirm docs mention per-language coverage in summary.

### 8.A Per-language subphases (inline)

| Language | Tasks |
| --- | --- |
| javascript | include in CI report + coverage tags |
| typescript | include in CI report + coverage tags |
| python | include in CI report + coverage tags |
| clike | include in CI report + coverage tags |
| go | include in CI report + coverage tags |
| java | include in CI report + coverage tags |
| csharp | include in CI report + coverage tags |
| kotlin | include in CI report + coverage tags |
| ruby | include in CI report + coverage tags |
| php | include in CI report + coverage tags |
| html | include in CI report + coverage tags |
| css | include in CI report + coverage tags |
| lua | include in CI report + coverage tags |
| sql | include in CI report + coverage tags |
| perl | include in CI report + coverage tags |
| shell | include in CI report + coverage tags |
| rust | include in CI report + coverage tags |
| swift | include in CI report + coverage tags |
| cmake | include in CI report + coverage tags |
| starlark | include in CI report + coverage tags |
| nix | include in CI report + coverage tags |
| dart | include in CI report + coverage tags |
| scala | include in CI report + coverage tags |
| groovy | include in CI report + coverage tags |
| r | include in CI report + coverage tags |
| julia | include in CI report + coverage tags |
| handlebars | include in CI report + coverage tags |
| mustache | include in CI report + coverage tags |
| jinja | include in CI report + coverage tags |
| razor | include in CI report + coverage tags |
| proto | include in CI report + coverage tags |
| makefile | include in CI report + coverage tags |
| dockerfile | include in CI report + coverage tags |
| graphql | include in CI report + coverage tags |

---

## Phase 9 — Cleanup + dedupe

**References**: Appendix P (per‑phase tables)

**Touchpoints**
- `tests/lang/harness/expectations.js` (new)
- `tests/lang/harness/fixtures.js` (new)
- `tests/lang/<id>/*.test.js` (refactor to shared harness)
- `tests/lang/<id>/fixture-sanity.test.js` (refactor to shared harness)

### 9.1 Harness consolidation

**Tasks**
- [ ] Extract shared expectations to `tests/lang/harness/expectations.js`.
- [ ] Extract fixture loading to `tests/lang/harness/fixtures.js`.
- [ ] Ensure no per‑language test hardcodes registry values.

**Per-language tasks**: see Section 9.A; migrate each language test to shared harness helpers.

### 9.A Per-language subphases (inline)

| Language | Tasks |
| --- | --- |
| javascript | dedupe via shared harness + expectations helper |
| typescript | dedupe via shared harness + expectations helper |
| python | dedupe via shared harness + expectations helper |
| clike | dedupe via shared harness + expectations helper |
| go | dedupe via shared harness + expectations helper |
| java | dedupe via shared harness + expectations helper |
| csharp | dedupe via shared harness + expectations helper |
| kotlin | dedupe via shared harness + expectations helper |
| ruby | dedupe via shared harness + expectations helper |
| php | dedupe via shared harness + expectations helper |
| html | dedupe via shared harness + expectations helper |
| css | dedupe via shared harness + expectations helper |
| lua | dedupe via shared harness + expectations helper |
| sql | dedupe via shared harness + expectations helper |
| perl | dedupe via shared harness + expectations helper |
| shell | dedupe via shared harness + expectations helper |
| rust | dedupe via shared harness + expectations helper |
| swift | dedupe via shared harness + expectations helper |
| cmake | dedupe via shared harness + expectations helper |
| starlark | dedupe via shared harness + expectations helper |
| nix | dedupe via shared harness + expectations helper |
| dart | dedupe via shared harness + expectations helper |
| scala | dedupe via shared harness + expectations helper |
| groovy | dedupe via shared harness + expectations helper |
| r | dedupe via shared harness + expectations helper |
| julia | dedupe via shared harness + expectations helper |
| handlebars | dedupe via shared harness + expectations helper |
| mustache | dedupe via shared harness + expectations helper |
| jinja | dedupe via shared harness + expectations helper |
| razor | dedupe via shared harness + expectations helper |
| proto | dedupe via shared harness + expectations helper |
| makefile | dedupe via shared harness + expectations helper |
| dockerfile | dedupe via shared harness + expectations helper |
| graphql | dedupe via shared harness + expectations helper |

---

## Phase 10 — Per‑language, per‑artifact checklists (expanded)

**References**: Appendix C (field‑level sub‑checks), Appendix D (minimum counts), Appendix D2 (presence/absence)

> Each language gets a full artifact checklist section. Each artifact includes **sub‑checks** for schema, counts, and deterministic ordering.

### 10.1 JavaScript checklist (expanded)
- **chunk_meta**
  - [ ] schemaVersion valid
  - [ ] required keys: id,start,end,metaV2 present
  - [ ] determinism: stable ordering by chunkUid
- **file_meta**
  - [ ] fileId indirection correct
  - [ ] file paths normalized
- **file_relations**
  - [ ] imports/calls/usages arrays present
  - [ ] deterministic ordering
- **graph_relations**
  - [ ] nodeCount/edgeCount correct
  - [ ] stable node ordering
- **import_resolution_graph**
  - [ ] nodes + edges present
  - [ ] resolved paths stable
- **symbols/symbol_occurrences/symbol_edges**
  - [ ] symbolId/scopedId present
  - [ ] edges reference valid symbols
- **risk_summaries**
  - [ ] schemaVersion + signals present
- **risk_interprocedural_stats + risk_flows**
  - [ ] stats schema valid
  - [ ] flows have valid flowId + path
- **call_sites**
  - [ ] callSiteId + range fields present
- **vfs_manifest**
  - [ ] segments for JSX/Vue
- **index_state/build_state**
  - [ ] schemaVersion + mode entries

### 10.2 TypeScript checklist (expanded)
- Same as JS + ensure type signatures in docmeta and symbol signatures.

### 10.3 Python checklist (expanded)
- chunk_meta, file_meta, file_relations, risk_summaries where supported.
- imports recorded in relations.
- determinism across runs.

### 10.4 CLike checklist (expanded)
- includes recorded in imports.
- file_relations calls present.
- graph relations stable.

### 10.5 Go checklist (expanded)
- imports present, relations calls present.
- docmeta includes receiver names.

### 10.6 Java checklist (expanded)
- imports, relations calls/usages.
- symbol graph stable.

### 10.7 CSharp checklist (expanded)
- imports and relations.
- call_sites present if enabled.

### 10.8 Kotlin checklist (expanded)
- imports and relations.

### 10.9 Ruby checklist (expanded)
- relations for method calls.

### 10.10 PHP checklist (expanded)
- imports and relations.

### 10.11 HTML checklist (expanded)
- chunk_meta + docmeta tags.

### 10.12 CSS checklist (expanded)
- chunk_meta + docmeta selectors.

### 10.13 Lua checklist (expanded)
- imports + relations.

### 10.14 SQL checklist (expanded)
- docmeta table names.

### 10.15 Perl checklist (expanded)
- imports + relations.

### 10.16 Shell checklist (expanded)
- source/includes recorded.

### 10.17 Rust checklist (expanded)
- imports + relations + symbol graph.

### 10.18 Swift checklist (expanded)
- imports + relations.

### 10.19 CMake checklist (expanded)
- include() recorded in imports.

### 10.20 Starlark checklist (expanded)
- load() recorded in imports.

### 10.21 Nix checklist (expanded)
- imports or references recorded if supported.

### 10.22 Dart checklist (expanded)
- imports + relations.

### 10.23 Scala checklist (expanded)
- imports + relations.

### 10.24 Groovy checklist (expanded)
- imports + relations.

### 10.25 R checklist (expanded)
- library() recorded if supported.

### 10.26 Julia checklist (expanded)
- imports + relations.

### 10.27 Handlebars checklist (expanded)
- template nodes present.

### 10.28 Mustache checklist (expanded)
- template nodes present.

### 10.29 Jinja checklist (expanded)
- template nodes present.

### 10.30 Razor checklist (expanded)
- template nodes present.

### 10.31 Proto checklist (expanded)
- message/service docmeta + imports.

### 10.32 Makefile checklist (expanded)
- include paths recorded.

### 10.33 Dockerfile checklist (expanded)
- instructions docmeta present.

### 10.34 GraphQL checklist (expanded)
- schema/type docmeta present.

---

## Acceptance criteria

Global (roadmap‑wide):
- `lang-full` lane runs for all supported languages.
- Any registry language without matrix entries fails tests.
- Per language:
  - indexing outputs present (chunk_meta, relations, docmeta)
  - AST/flow validated where supported
  - graph + symbol artifacts validated where supported
  - risk outputs validated where supported
  - search/API boundary filters validated
  - determinism validated

Phase completion checklists:
- **Phase 0**: matrix JSONs exist; drift tests pass; registry coverage = 100%.
- **Phase 1**: lang-full lane defined; order file locked; ordering test passes.
- **Phase 2**: fixtures exist for every language; fixture‑sanity tests pass.
- **Phase 3**: AST/flow tests pass for all AST‑capable languages; negative AST tests pass.
- **Phase 4**: relations + symbol graph tests pass; absence checks pass.
- **Phase 5**: risk local/interproc tests pass; absence checks pass.
- **Phase 6**: search filters + API parity tests pass for every language.
- **Phase 7**: determinism tests pass for all languages.
- **Phase 8**: CI reporting artifacts generated; docs updated; lane visible in commands doc.
- **Phase 9**: shared harness used by all language tests; no per‑language duplication.
- **Phase 10**: per‑language artifact checklists validated (Appendix C/D/D2 complete).

---

## Appendix A — Common artifact checklist template (apply to every language)

> Use this template verbatim for each language, then add language-specific expectations in Appendix B.

### A.1 Core artifacts (always present)

- **file_meta.json**
  - [ ] fileId unique per file
  - [ ] path is repo-relative, normalized (posix), no traversal
  - [ ] byteLength, lineCount, encoding populated
  - [ ] deterministic ordering by fileId (or path if specified)
- **chunk_meta.json / sharded chunk_meta**
  - [ ] chunkUid stable across runs
  - [ ] start/end byte offsets and startLine/endLine consistent
  - [ ] metaV2 object present and schema-valid
  - [ ] tokens/chargrams counts non-negative
  - [ ] deterministic ordering by chunkUid
- **pieces manifest**
  - [ ] all artifacts listed with correct counts
  - [ ] counts match actual JSONL/JSON row counts
  - [ ] shard counts sum correctly
- **index_state.json**
  - [ ] buildId, schemaVersion, mode set
  - [ ] deterministic fields only (non-deterministic fields documented)
- **build_state.json**
  - [ ] repo provenance present (provider, head)
  - [ ] schemaVersion, buildId, mode

### A.2 Relations + graphs (if supported)

- **file_relations.jsonl**
  - [ ] call/usages/imports edges present when applicable
  - [ ] edge ordering deterministic
  - [ ] edges reference valid fileIds/chunkUids
- **graph_relations.json**
  - [ ] node + edge counts stable
  - [ ] stable ordering by node id/edge id
  - [ ] generatedAt excluded from determinism checks if configured
- **import_resolution_graph.json**
  - [ ] nodes include every import source
  - [ ] edges link to resolved targets
  - [ ] unresolved edges labeled correctly

### A.3 Symbol graph (if supported)

- **symbols.jsonl**
  - [ ] symbolId + scopedId present
  - [ ] name + kind + range fields present
- **symbol_occurrences.jsonl**
  - [ ] symbolId references valid symbols
  - [ ] range + fileId valid
- **symbol_edges.jsonl**
  - [ ] edges reference valid symbolIds
  - [ ] relation kinds are valid

### A.4 Risk pack (if enabled)

- **risk_summaries.jsonl**
  - [ ] schemaVersion + signal entries present
  - [ ] stable ordering of summaries
- **risk_interprocedural_stats.json**
  - [ ] mode + callSiteSampling fields present
  - [ ] timingMs includes io
  - [ ] status ok/disabled consistent with config
- **risk_flows.jsonl**
  - [ ] flowId stable
  - [ ] path nodes valid

### A.5 Call sites (if enabled)

- **call_sites.jsonl**
  - [ ] callSiteId stable
  - [ ] range/start/end present
  - [ ] callee/caller info populated when possible

### A.6 VFS + segments (if supported)

- **vfs_manifest.json**
  - [ ] segments include file ranges for embedded content
  - [ ] segments ordered by file/start

### A.7 Embeddings (if enabled)

- **embeddings artifacts**
  - [ ] vector dims match config
  - [ ] counts match chunk counts
  - [ ] index + table artifacts present for backend

---

## Appendix B — Per-language deep checklist (expanded)

> Each language gets a dedicated list of **fixture requirements**, **expected relations**, **artifact expectations**, and **tests**. Every item should be validated in the lang-full lane.

### B.1 JavaScript

**Fixture requirements**
- [ ] ES modules + CommonJS mixed
- [ ] Default export + named exports
- [ ] Class + function + arrow function + generator
- [ ] React JSX component (hooks + props)
- [ ] Dynamic import + require

**Expected relations**
- [ ] import graph edges for ES imports
- [ ] require() edges recorded
- [ ] call_sites include React component calls

**Artifacts (apply Appendix A)**
- [ ] chunk_meta includes JSX ranges
- [ ] vfs_manifest includes JSX segments if extracted

**Tests**
- `tests/lang/javascript/fixture-sanity.test.js`
- `tests/lang/javascript/relations.test.js`
- `tests/lang/javascript/ast-flow.test.js`
- `tests/lang/javascript/symbol-graph.test.js`
- `tests/lang/javascript/risk-local.test.js`

### B.2 TypeScript

**Fixture requirements**
- [ ] TS interface + type alias
- [ ] generics, overloads, namespaces
- [ ] React TSX component
- [ ] enums + decorators (if supported)
- [ ] path alias import (tsconfig paths)

**Expected relations**
- [ ] import graph edges for TS imports
- [ ] symbol graph includes type symbols

**Artifacts**
- [ ] metaV2 includes type signatures

**Tests**
- `tests/lang/typescript/fixture-sanity.test.js`
- `tests/lang/typescript/relations.test.js`
- `tests/lang/typescript/ast-flow.test.js`
- `tests/lang/typescript/symbol-graph.test.js`

### B.3 Python

**Fixture requirements**
- [ ] module import + from import
- [ ] class with method + decorator
- [ ] async function + await
- [ ] type hints (PEP484)

**Expected relations**
- [ ] import graph edges from import/from
- [ ] call_sites include method calls

**Tests**
- `tests/lang/python/fixture-sanity.test.js`
- `tests/lang/python/relations.test.js`

### B.4 CLike (C/C++)

**Fixture requirements**
- [ ] #include local + system
- [ ] struct + class + namespace
- [ ] function pointer usage
- [ ] template or macro usage

**Expected relations**
- [ ] include edges recorded
- [ ] call_sites include function calls

**Tests**
- `tests/lang/clike/fixture-sanity.test.js`
- `tests/lang/clike/relations.test.js`

### B.5 Go

**Fixture requirements**
- [ ] package + import
- [ ] interface + struct + method
- [ ] goroutine + channel usage

**Expected relations**
- [ ] import edges recorded
- [ ] call_sites include method calls

**Tests**
- `tests/lang/go/fixture-sanity.test.js`
- `tests/lang/go/relations.test.js`

### B.6 Java

**Fixture requirements**
- [ ] package + import
- [ ] class + interface + enum
- [ ] lambda + anonymous class

**Expected relations**
- [ ] import edges
- [ ] call_sites include method calls

**Tests**
- `tests/lang/java/fixture-sanity.test.js`
- `tests/lang/java/relations.test.js`

### B.7 CSharp

**Fixture requirements**
- [ ] namespace + using
- [ ] class + interface + attribute
- [ ] async/await

**Expected relations**
- [ ] import edges
- [ ] call_sites include method calls

**Tests**
- `tests/lang/csharp/fixture-sanity.test.js`

### B.8 Kotlin

**Fixture requirements**
- [ ] package + import
- [ ] data class + sealed class
- [ ] extension function

**Tests**
- `tests/lang/kotlin/fixture-sanity.test.js`

### B.9 Ruby

**Fixture requirements**
- [ ] require + module
- [ ] class + method
- [ ] block/yield

**Tests**
- `tests/lang/ruby/fixture-sanity.test.js`

### B.10 PHP

**Fixture requirements**
- [ ] namespace + use
- [ ] class + trait + interface
- [ ] composer autoload example

**Tests**
- `tests/lang/php/fixture-sanity.test.js`

### B.11 HTML

**Fixture requirements**
- [ ] nested DOM + script/style tags
- [ ] data-* attributes

**Tests**
- `tests/lang/html/fixture-sanity.test.js`

### B.12 CSS

**Fixture requirements**
- [ ] selectors: class/id/attribute
- [ ] @media + @keyframes

**Tests**
- `tests/lang/css/fixture-sanity.test.js`

### B.13 Lua

**Fixture requirements**
- [ ] require + module
- [ ] table + metatable

**Tests**
- `tests/lang/lua/fixture-sanity.test.js`

### B.14 SQL

**Fixture requirements**
- [ ] create table + index
- [ ] select join + CTE

**Tests**
- `tests/lang/sql/fixture-sanity.test.js`

### B.15 Perl

**Fixture requirements**
- [ ] use + package
- [ ] sub + regex

**Tests**
- `tests/lang/perl/fixture-sanity.test.js`

### B.16 Shell

**Fixture requirements**
- [ ] source + export
- [ ] function + pipe

**Tests**
- `tests/lang/shell/fixture-sanity.test.js`

### B.17 Rust

**Fixture requirements**
- [ ] mod + use
- [ ] struct + trait + impl
- [ ] generic + lifetime

**Tests**
- `tests/lang/rust/fixture-sanity.test.js`

### B.18 Swift

**Fixture requirements**
- [ ] import + class
- [ ] protocol + extension

**Tests**
- `tests/lang/swift/fixture-sanity.test.js`

### B.19 CMake

**Fixture requirements**
- [ ] include + add_executable

**Tests**
- `tests/lang/cmake/fixture-sanity.test.js`

### B.20 Starlark

**Fixture requirements**
- [ ] load + rule

**Tests**
- `tests/lang/starlark/fixture-sanity.test.js`

### B.21 Nix

**Fixture requirements**
- [ ] import + let/in

**Tests**
- `tests/lang/nix/fixture-sanity.test.js`

### B.22 Dart

**Fixture requirements**
- [ ] import + class
- [ ] async

**Tests**
- `tests/lang/dart/fixture-sanity.test.js`

### B.23 Scala

**Fixture requirements**
- [ ] import + class
- [ ] object + trait

**Tests**
- `tests/lang/scala/fixture-sanity.test.js`

### B.24 Groovy

**Fixture requirements**
- [ ] import + class
- [ ] closure

**Tests**
- `tests/lang/groovy/fixture-sanity.test.js`

### B.25 R

**Fixture requirements**
- [ ] library + function

**Tests**
- `tests/lang/r/fixture-sanity.test.js`

### B.26 Julia

**Fixture requirements**
- [ ] using + module

**Tests**
- `tests/lang/julia/fixture-sanity.test.js`

### B.27 Handlebars

**Fixture requirements**
- [ ] partial + helper

**Tests**
- `tests/lang/handlebars/fixture-sanity.test.js`

### B.28 Mustache

**Fixture requirements**
- [ ] section + variable

**Tests**
- `tests/lang/mustache/fixture-sanity.test.js`

### B.29 Jinja

**Fixture requirements**
- [ ] block + include

**Tests**
- `tests/lang/jinja/fixture-sanity.test.js`

### B.30 Razor

**Fixture requirements**
- [ ] directive + inline code

**Tests**
- `tests/lang/razor/fixture-sanity.test.js`

### B.31 Proto

**Fixture requirements**
- [ ] message + service

**Tests**
- `tests/lang/proto/fixture-sanity.test.js`

### B.32 Makefile

**Fixture requirements**
- [ ] include + target

**Tests**
- `tests/lang/makefile/fixture-sanity.test.js`

### B.33 Dockerfile

**Fixture requirements**
- [ ] FROM + RUN + COPY

**Tests**
- `tests/lang/dockerfile/fixture-sanity.test.js`

### B.34 GraphQL

**Fixture requirements**
- [ ] type + query

**Tests**
- `tests/lang/graphql/fixture-sanity.test.js`

---

## Appendix C — Per‑language per‑artifact sub‑checks (full detail)

> For each language, validate **every artifact** from Appendix A, plus the language‑specific expectations below. If an artifact is not supported for a language, the test should assert it is **absent** or **empty by contract**.

### C.1 JavaScript (ESM + CJS + React)

- **file_meta.json**
  - [ ] paths include `.js`, `.mjs`, `.cjs`, `.jsx`
  - [ ] encoding detected for UTF‑8 + latin1 fixtures
- **chunk_meta.json**
  - [ ] JSX chunks include `metaV2.kind="code"` with `language="javascript"`
  - [ ] chunk boundaries align to JSX tags and function blocks
- **file_relations.jsonl**
  - [ ] ES `import` edges recorded
  - [ ] `require()` edges recorded
  - [ ] dynamic import edges recorded
- **import_resolution_graph.json**
  - [ ] resolves relative + bare module imports
  - [ ] unresolved modules tracked with reason
- **graph_relations.json**
  - [ ] call edges for functions + class methods
- **symbols.jsonl / symbol_edges.jsonl**
  - [ ] functions, classes, variables, exports
  - [ ] edges for `export`/`import` symbol relations
- **risk_* artifacts**
  - [ ] local risk signals for `eval`, dynamic import, exec‑like patterns
- **call_sites.jsonl**
  - [ ] call sites for hooks + class methods
- **vfs_manifest.json**
  - [ ] JSX embedded segments listed when extracted‑prose enabled
- **embeddings**
  - [ ] vectors emitted for JS chunks when enabled

### C.2 TypeScript (TS + TSX)

- **file_meta.json**
  - [ ] `.ts`, `.tsx` entries with correct language
- **chunk_meta.json**
  - [ ] metaV2 includes `signature` for functions + types
- **file_relations.jsonl**
  - [ ] `import type` edges recorded
- **import_resolution_graph.json**
  - [ ] tsconfig path alias resolution recorded
- **symbols.jsonl**
  - [ ] interfaces, type aliases, enums, namespaces
- **symbol_edges.jsonl**
  - [ ] implements/extends edges
- **call_sites.jsonl**
  - [ ] class method invocations + generic calls
- **vfs_manifest.json**
  - [ ] TSX segment extraction listed

### C.3 Python

- **file_meta.json**
  - [ ] `.py` entries
- **chunk_meta.json**
  - [ ] class + def blocks become chunks
- **file_relations.jsonl**
  - [ ] `import` + `from x import y` edges
- **symbols.jsonl**
  - [ ] classes, functions, decorators
- **call_sites.jsonl**
  - [ ] function + method calls
- **risk_* artifacts**
  - [ ] local risk signals for `eval`, `exec`, `subprocess`

### C.4 C/C++ (clike)

- **file_meta.json**
  - [ ] `.c`, `.h`, `.cpp`, `.hpp` entries
- **chunk_meta.json**
  - [ ] function blocks, class/struct blocks
- **file_relations.jsonl**
  - [ ] `#include` edges (local + system)
- **symbols.jsonl**
  - [ ] functions, structs, classes, namespaces
- **call_sites.jsonl**
  - [ ] function calls
- **risk_* artifacts**
  - [ ] local risk signals for `system`, `strcpy`

### C.5 Go

- **file_meta.json**
  - [ ] `.go` entries
- **chunk_meta.json**
  - [ ] package‑level funcs + methods
- **file_relations.jsonl**
  - [ ] `import` edges
- **symbols.jsonl**
  - [ ] types, funcs, methods
- **call_sites.jsonl**
  - [ ] method calls and interface usage

### C.6 Java

- **file_meta.json**
  - [ ] `.java` entries
- **chunk_meta.json**
  - [ ] class + method blocks
- **file_relations.jsonl**
  - [ ] `import` edges
- **symbols.jsonl**
  - [ ] classes, interfaces, enums
- **call_sites.jsonl**
  - [ ] method calls

### C.7 CSharp

- **file_meta.json**
  - [ ] `.cs` entries
- **chunk_meta.json**
  - [ ] class + method blocks
- **file_relations.jsonl**
  - [ ] `using` edges
- **symbols.jsonl**
  - [ ] classes, interfaces, attributes

### C.8 Kotlin

- **file_meta.json**: `.kt`
- **chunk_meta.json**: class + function blocks
- **file_relations.jsonl**: `import` edges
- **symbols.jsonl**: classes, data classes, extension functions

### C.9 Ruby

- **file_meta.json**: `.rb`
- **chunk_meta.json**: class/module/def blocks
- **file_relations.jsonl**: `require` edges
- **symbols.jsonl**: classes, modules, methods

### C.10 PHP

- **file_meta.json**: `.php`
- **chunk_meta.json**: class/trait/function blocks
- **file_relations.jsonl**: `use` edges
- **symbols.jsonl**: classes, traits, functions

### C.11 HTML

- **file_meta.json**: `.html`, `.htm`
- **chunk_meta.json**: chunk per document or per section
- **docmeta**: tags + attributes extracted
- **symbols.jsonl**: none (assert absent)

### C.12 CSS

- **file_meta.json**: `.css`
- **chunk_meta.json**: rulesets
- **docmeta**: selectors, at‑rules

### C.13 Lua

- **file_meta.json**: `.lua`
- **chunk_meta.json**: functions
- **file_relations.jsonl**: `require` edges

### C.14 SQL

- **file_meta.json**: `.sql`
- **chunk_meta.json**: statements
- **docmeta**: table + column references

### C.15 Perl

- **file_meta.json**: `.pl`, `.pm`
- **chunk_meta.json**: sub blocks
- **file_relations.jsonl**: `use` edges

### C.16 Shell

- **file_meta.json**: `.sh`, `.bash`
- **chunk_meta.json**: function blocks
- **file_relations.jsonl**: `source` edges

### C.17 Rust

- **file_meta.json**: `.rs`
- **chunk_meta.json**: mod/impl/trait blocks
- **file_relations.jsonl**: `use` edges
- **symbols.jsonl**: structs, traits, impls

### C.18 Swift

- **file_meta.json**: `.swift`
- **chunk_meta.json**: class/struct/func blocks
- **file_relations.jsonl**: `import` edges

### C.19 CMake

- **file_meta.json**: `CMakeLists.txt`, `.cmake`
- **file_relations.jsonl**: `include()` edges

### C.20 Starlark

- **file_meta.json**: `.bzl`, `BUILD`
- **file_relations.jsonl**: `load()` edges

### C.21 Nix

- **file_meta.json**: `.nix`
- **file_relations.jsonl**: `import` edges

### C.22 Dart

- **file_meta.json**: `.dart`
- **file_relations.jsonl**: `import` edges

### C.23 Scala

- **file_meta.json**: `.scala`
- **file_relations.jsonl**: `import` edges

### C.24 Groovy

- **file_meta.json**: `.groovy`
- **file_relations.jsonl**: `import` edges

### C.25 R

- **file_meta.json**: `.r`, `.R`
- **file_relations.jsonl**: `library()` edges if supported

### C.26 Julia

- **file_meta.json**: `.jl`
- **file_relations.jsonl**: `using/import` edges

### C.27 Handlebars

- **file_meta.json**: `.hbs`
- **chunk_meta.json**: template blocks

### C.28 Mustache

- **file_meta.json**: `.mustache`
- **chunk_meta.json**: template blocks

### C.29 Jinja

- **file_meta.json**: `.j2`, `.jinja`
- **chunk_meta.json**: template blocks

### C.30 Razor

- **file_meta.json**: `.cshtml`
- **chunk_meta.json**: template blocks

### C.31 Proto

- **file_meta.json**: `.proto`
- **docmeta**: messages/services
- **file_relations.jsonl**: `import` edges

### C.32 Makefile

- **file_meta.json**: `Makefile`, `.mk`
- **file_relations.jsonl**: `include` edges

### C.33 Dockerfile

- **file_meta.json**: `Dockerfile`
- **docmeta**: instruction list

### C.34 GraphQL

- **file_meta.json**: `.graphql`, `.gql`
- **docmeta**: type + query defs

---

## Appendix D — Per‑language per‑artifact sub‑checklists (expanded with minimum counts)

> This section **repeats Appendix A per language** and adds concrete, language‑specific minimum counts. These are the authoritative per‑language expectations.

### D.1 JavaScript (ESM + CJS + React)

**file_meta.json**
- [ ] ≥4 files (.js/.jsx) with unique fileIds
- [ ] paths include at least one .jsx

**chunk_meta.json**
- [ ] ≥6 chunks
- [ ] JSX chunk present with metaV2.kind="code"

**file_relations.jsonl**
- [ ] ≥3 import edges (ES + require)

**symbols.jsonl**
- [ ] ≥8 symbols (class, function, const, export)

**call_sites.jsonl**
- [ ] ≥5 call sites (including React hook call)

**risk_summaries.jsonl**
- [ ] ≥1 local risk signal (eval/dynamic import fixture)

### D.2 TypeScript (TS + TSX)

**file_meta.json**
- [ ] ≥4 files (.ts/.tsx)

**chunk_meta.json**
- [ ] ≥6 chunks with signatures

**file_relations.jsonl**
- [ ] ≥3 import edges

**symbols.jsonl**
- [ ] ≥10 symbols (interface, type alias, enum)

**call_sites.jsonl**
- [ ] ≥4 call sites

### D.3 Python

**file_meta.json**
- [ ] ≥3 .py files

**chunk_meta.json**
- [ ] ≥5 chunks (class + def)

**file_relations.jsonl**
- [ ] ≥2 import edges

**symbols.jsonl**
- [ ] ≥6 symbols (class, functions)

### D.4 C/C++

**file_meta.json**
- [ ] ≥3 files (.c/.h)

**chunk_meta.json**
- [ ] ≥4 chunks (functions/structs)

**file_relations.jsonl**
- [ ] ≥2 include edges

### D.5 Go

**file_meta.json**
- [ ] ≥3 .go files

**chunk_meta.json**
- [ ] ≥5 chunks

**file_relations.jsonl**
- [ ] ≥2 import edges

### D.6 Java

**file_meta.json**
- [ ] ≥3 .java files

**chunk_meta.json**
- [ ] ≥5 chunks

**file_relations.jsonl**
- [ ] ≥2 import edges

### D.7 CSharp

**file_meta.json**
- [ ] ≥3 .cs files

**chunk_meta.json**
- [ ] ≥5 chunks

**file_relations.jsonl**
- [ ] ≥2 using edges

### D.8 Kotlin

**file_meta.json**
- [ ] ≥2 .kt files

**chunk_meta.json**
- [ ] ≥3 chunks

**file_relations.jsonl**
- [ ] ≥1 import edge

### D.9 Ruby

**file_meta.json**
- [ ] ≥2 .rb files

**chunk_meta.json**
- [ ] ≥3 chunks

**file_relations.jsonl**
- [ ] ≥1 require edge

### D.10 PHP

**file_meta.json**
- [ ] ≥2 .php files

**chunk_meta.json**
- [ ] ≥3 chunks

### D.11 HTML

**file_meta.json**
- [ ] ≥2 .html files

**chunk_meta.json**
- [ ] ≥2 chunks

**docmeta**
- [ ] ≥1 tag extraction

### D.12 CSS

**file_meta.json**
- [ ] ≥2 .css files

**chunk_meta.json**
- [ ] ≥2 chunks

**docmeta**
- [ ] ≥1 selector extraction

### D.13 Lua

**file_meta.json**
- [ ] ≥2 .lua files

**chunk_meta.json**
- [ ] ≥3 chunks

### D.14 SQL

**file_meta.json**
- [ ] ≥2 .sql files

**chunk_meta.json**
- [ ] ≥2 chunks

### D.15 Perl

**file_meta.json**
- [ ] ≥2 .pl/.pm files

**chunk_meta.json**
- [ ] ≥2 chunks

### D.16 Shell

**file_meta.json**
- [ ] ≥2 .sh files

**chunk_meta.json**
- [ ] ≥2 chunks

### D.17 Rust

**file_meta.json**
- [ ] ≥2 .rs files

**chunk_meta.json**
- [ ] ≥3 chunks

**symbols.jsonl**
- [ ] ≥4 symbols

### D.18 Swift

**file_meta.json**
- [ ] ≥2 .swift files

**chunk_meta.json**
- [ ] ≥3 chunks

### D.19 CMake

**file_meta.json**
- [ ] ≥1 CMakeLists.txt

### D.20 Starlark

**file_meta.json**
- [ ] ≥2 .bzl/BUILD files

### D.21 Nix

**file_meta.json**
- [ ] ≥1 .nix file

### D.22 Dart

**file_meta.json**
- [ ] ≥2 .dart files

### D.23 Scala

**file_meta.json**
- [ ] ≥2 .scala files

### D.24 Groovy

**file_meta.json**
- [ ] ≥2 .groovy files

### D.25 R

**file_meta.json**
- [ ] ≥1 .R file

### D.26 Julia

**file_meta.json**
- [ ] ≥1 .jl file

### D.27 Handlebars

**file_meta.json**
- [ ] ≥1 .hbs file

### D.28 Mustache

**file_meta.json**
- [ ] ≥1 .mustache file

### D.29 Jinja

**file_meta.json**
- [ ] ≥1 .j2 file

### D.30 Razor

**file_meta.json**
- [ ] ≥1 .cshtml file

### D.31 Proto

**file_meta.json**
- [ ] ≥1 .proto file

### D.32 Makefile

**file_meta.json**
- [ ] ≥1 Makefile

### D.33 Dockerfile

**file_meta.json**
- [ ] ≥1 Dockerfile

### D.34 GraphQL

**file_meta.json**
- [ ] ≥1 .graphql file

---

## Appendix D2 — Full artifact coverage matrix per language (presence/absence)

> For every language, explicitly assert whether each artifact should be **present** or **absent/empty**. Use this to avoid silent gaps.

Legend: **P** = present with content, **E** = empty allowed, **A** = absent expected.

**Artifacts:**
- file_meta, chunk_meta, pieces_manifest, index_state, build_state
- file_relations, graph_relations, import_resolution_graph
- symbols, symbol_occurrences, symbol_edges
- risk_summaries, risk_interprocedural_stats, risk_flows
- call_sites
- vfs_manifest
- embeddings (vectors + index)

### D2.1 JavaScript
- core: P
- relations/graphs: P
- symbols: P
- risk: P
- call_sites: P
- vfs_manifest (JSX/React): P
- embeddings: P (when enabled)

### D2.2 TypeScript
- core: P
- relations/graphs: P
- symbols: P
- risk: P
- call_sites: P
- vfs_manifest (TSX/Vue): P
- embeddings: P

### D2.3 Python
- core: P
- relations/graphs: P
- symbols: P
- risk: P (local); interprocedural optional → E
- call_sites: P
- vfs_manifest: A
- embeddings: P

### D2.4 C/C++
- core: P
- relations/graphs: P
- symbols: P
- risk: P (local); interprocedural optional → E
- call_sites: P
- vfs_manifest: A
- embeddings: P

### D2.5 Go
- core: P
- relations/graphs: P
- symbols: P
- risk: P (local); interprocedural optional → E
- call_sites: P
- vfs_manifest: A
- embeddings: P

### D2.6 Java
- core: P
- relations/graphs: P
- symbols: P
- risk: P (local); interprocedural optional → E
- call_sites: P
- vfs_manifest: A
- embeddings: P

### D2.7 CSharp
- core: P
- relations/graphs: P
- symbols: P
- risk: P (local); interprocedural optional → E
- call_sites: P
- vfs_manifest: A
- embeddings: P

### D2.8 Kotlin
- core: P
- relations/graphs: P
- symbols: P
- risk: E (if not supported)
- call_sites: E
- vfs_manifest: A
- embeddings: P

### D2.9 Ruby
- core: P
- relations/graphs: P
- symbols: P
- risk: E
- call_sites: E
- vfs_manifest: A
- embeddings: P

### D2.10 PHP
- core: P
- relations/graphs: P
- symbols: P
- risk: E
- call_sites: E
- vfs_manifest: A
- embeddings: P

### D2.11 HTML
- core: P
- relations/graphs: A
- symbols: A
- risk: A
- call_sites: A
- vfs_manifest: P (if extracted‑prose enabled)
- embeddings: P (if enabled)

### D2.12 CSS
- core: P
- relations/graphs: A
- symbols: A
- risk: A
- call_sites: A
- vfs_manifest: P (if extracted)
- embeddings: P (if enabled)

### D2.13 Lua
- core: P
- relations/graphs: P
- symbols: P
- risk: E
- call_sites: E
- vfs_manifest: A
- embeddings: P

### D2.14 SQL
- core: P
- relations/graphs: E
- symbols: E
- risk: A
- call_sites: A
- vfs_manifest: A
- embeddings: P

### D2.15 Perl
- core: P
- relations/graphs: P
- symbols: P
- risk: E
- call_sites: E
- vfs_manifest: A
- embeddings: P

### D2.16 Shell
- core: P
- relations/graphs: P
- symbols: E
- risk: E
- call_sites: E
- vfs_manifest: A
- embeddings: P

### D2.17 Rust
- core: P
- relations/graphs: P
- symbols: P
- risk: P (local); interprocedural optional → E
- call_sites: P
- vfs_manifest: A
- embeddings: P

### D2.18 Swift
- core: P
- relations/graphs: P
- symbols: P
- risk: E
- call_sites: E
- vfs_manifest: A
- embeddings: P

### D2.19 CMake
- core: P
- relations/graphs: E
- symbols: A
- risk: A
- call_sites: A
- vfs_manifest: A
- embeddings: P

### D2.20 Starlark
- core: P
- relations/graphs: E
- symbols: E
- risk: A
- call_sites: A
- vfs_manifest: A
- embeddings: P

### D2.21 Nix
- core: P
- relations/graphs: E
- symbols: E
- risk: A
- call_sites: A
- vfs_manifest: A
- embeddings: P

### D2.22 Dart
- core: P
- relations/graphs: P
- symbols: P
- risk: E
- call_sites: E
- vfs_manifest: A
- embeddings: P

### D2.23 Scala
- core: P
- relations/graphs: P
- symbols: P
- risk: E
- call_sites: E
- vfs_manifest: A
- embeddings: P

### D2.24 Groovy
- core: P
- relations/graphs: P
- symbols: P
- risk: E
- call_sites: E
- vfs_manifest: A
- embeddings: P

### D2.25 R
- core: P
- relations/graphs: E
- symbols: E
- risk: A
- call_sites: A
- vfs_manifest: A
- embeddings: P

### D2.26 Julia
- core: P
- relations/graphs: E
- symbols: E
- risk: A
- call_sites: A
- vfs_manifest: A
- embeddings: P

### D2.27 Handlebars
- core: P
- relations/graphs: A
- symbols: A
- risk: A
- call_sites: A
- vfs_manifest: P (templating segments)
- embeddings: P

### D2.28 Mustache
- core: P
- relations/graphs: A
- symbols: A
- risk: A
- call_sites: A
- vfs_manifest: P
- embeddings: P

### D2.29 Jinja
- core: P
- relations/graphs: A
- symbols: A
- risk: A
- call_sites: A
- vfs_manifest: P
- embeddings: P

### D2.30 Razor
- core: P
- relations/graphs: A
- symbols: A
- risk: A
- call_sites: A
- vfs_manifest: P
- embeddings: P

### D2.31 Proto
- core: P
- relations/graphs: E (imports)
- symbols: P (messages/services)
- risk: A
- call_sites: A
- vfs_manifest: A
- embeddings: P

### D2.32 Makefile
- core: P
- relations/graphs: E
- symbols: A
- risk: A
- call_sites: A
- vfs_manifest: A
- embeddings: P

### D2.33 Dockerfile
- core: P
- relations/graphs: A
- symbols: A
- risk: A
- call_sites: A
- vfs_manifest: A
- embeddings: P

### D2.34 GraphQL
- core: P
- relations/graphs: A
- symbols: P (types/fields)
- risk: A
- call_sites: A
- vfs_manifest: A
- embeddings: P

---

## Appendix E — Per‑subsystem matrix (language × subsystem)

> Each subsystem must define **goal**, **edge cases**, **tests**, and **pass/fail criteria**. Use this matrix to ensure no subsystem is under‑tested.

### D.1 Indexing core (all languages)

**Goal**: stable chunking, file discovery, deterministic artifacts.

**Edge cases**
- [ ] empty files
- [ ] large files beyond caps
- [ ] encoding fallback

**Tests**
- `tests/lang/<id>/fixture-sanity.test.js`
- `tests/lang/<id>/determinism.test.js`

**Pass criteria**
- all artifacts schema‑valid + deterministic ordering

### D.2 AST extraction (languages with AST)

**Goal**: AST nodes emitted, range coverage.

**Edge cases**
- [ ] nested generics, decorators
- [ ] JSX/TSX templates

**Tests**
- `tests/lang/<id>/ast-flow.test.js`

**Pass criteria**
- AST nodes >= expected counts

### D.3 Control flow (supported languages)

**Goal**: control flow graph nodes + edges.

**Edge cases**
- [ ] loops + breaks
- [ ] exceptions/throws

**Tests**
- `tests/lang/<id>/ast-flow.test.js`

### D.4 Data flow (supported languages)

**Goal**: variable def/use links.

**Edge cases**
- [ ] closures + captures

### D.5 Symbol graph (supported languages)

**Goal**: symbol edges + occurrences stable.

**Tests**
- `tests/lang/<id>/symbol-graph.test.js`

### D.6 Risk pack (supported languages)

**Goal**: local + interprocedural risk artifacts present or explicitly disabled.

**Tests**
- `tests/lang/<id>/risk-local.test.js`
- `tests/lang/risk-interprocedural-matrix.test.js`

### D.7 API boundary / CLI search

**Goal**: search filters operate per language.

**Tests**
- `tests/lang/<id>/search-filters.test.js`
- `tests/lang/api/search-language.test.js`

### D.8 Graph artifacts

**Goal**: graph_relations + import_resolution_graph stable.

**Tests**
- `tests/lang/<id>/relations.test.js`

### D.9 Embeddings (when enabled)

**Goal**: embedding counts match chunks.

**Tests**
- `tests/lang/<id>/embeddings.test.js`

### D.10 VFS / segments (embedded languages)

**Goal**: vfs_manifest contains extracted segments.

**Tests**
- `tests/lang/<id>/vfs.test.js`

---

## Appendix F — Fixture file lists per language (deterministic assertions)

> For each language, add an explicit fixture inventory: file paths, canonical symbols, and expected ranges. This upgrades “minimum counts” into deterministic checks.

**Tasks**
- [ ] Add `tests/lang/fixtures/<id>/fixture-inventory.json` with:
  - file list (relative path)
  - symbols expected (name, kind, file, line range)
  - expected import edges (source → target)
- [ ] Add `tests/lang/<id>/fixture-inventory.test.js` to validate:
  - all files exist
  - symbol ranges match chunk ranges
  - expected imports present

---

## Appendix G — Schema version expectations (per artifact)

> Lock expected schemaVersion per artifact to prevent silent contract drift.

**Tasks**
- [ ] Add `tests/lang/matrix/schema-versions.json` mapping artifact → allowed versions.
- [ ] Add `tests/lang/schema/schema-version.test.js`:
  - assert each artifact’s schemaVersion is in allowed list
- [ ] Document allowable versions in `docs/contracts/indexing.md`.

---

## Appendix H — Negative assertions per language

> Explicitly assert *absent* artifacts for languages that don’t support them.

**Tasks**
- [ ] Add `tests/lang/<id>/negative-artifacts.test.js`:
  - assert symbols absent for HTML/CSS
  - assert call_sites absent for template languages
  - assert risk artifacts absent when disabled by policy

---

## Appendix I — Golden snapshot artifacts

> Provide stable “golden” JSON/JSONL snapshots for each language artifact.

**Tasks**
- [ ] Add `tests/lang/goldens/<id>/<artifact>.json` for core artifacts.
- [ ] Add `tests/lang/<id>/golden-artifacts.test.js`:
  - compare normalized outputs to golden
  - ignore documented nondeterministic fields

---

## Appendix J — Failure‑mode checklist

> For each subsystem, validate error paths with explicit cases.

**Tasks**
- [ ] Add `tests/lang/failures/encoding-fallback.test.js`.
- [ ] Add `tests/lang/failures/malformed-import.test.js`.
- [ ] Add `tests/lang/failures/missing-deps.test.js`.
- [ ] Ensure error codes + hints match `docs/contracts/indexing.md`.

---

## Appendix K — Performance bounds per language

> Add upper bounds to prevent slow regressions on fixtures.

**Tasks**
- [ ] Add `tests/lang/perf/lang-perf-budget.json` (per language):
  - max indexing time, max memory, max artifact bytes
- [ ] Add `tests/lang/perf/lang-perf-budget.test.js`.

---

## Appendix L — Mixed‑language integration fixture

> Add a shared repo fixture spanning multiple languages.

**Tasks**
- [ ] Create `tests/fixtures/languages/mixed/` with JS+TS+Py+SQL.
- [ ] Add `tests/lang/mixed/mixed-relations.test.js`:
  - cross‑language import edges
  - graph relations consistency

---

## Appendix M — Roadmap linkage tags

> Link each test to roadmap items for reporting coverage.

**Tasks**
- [ ] Add `tests/lang/matrix/roadmap-tags.json` mapping test → roadmap item.
- [ ] Add `tests/lang/matrix/roadmap-tags.test.js`.
- [ ] Emit report in CI: `docs/tooling/lang-roadmap-coverage.json`.

---

## Appendix N — Test ordering contracts

> Ensure stable per‑language test ordering for lang‑full.

**Tasks**
- [ ] Add `tests/lang-full/lang-full.order.json` with per‑language ordering:
  - fixture‑sanity → relations → ast‑flow → risk → api → determinism
- [ ] Enforce order in runner for lang‑full lane only.

---

## Appendix O — Feature‑toggle matrix (per language)

> Validate behavior under toggles (tree‑sitter, embeddings, risk).

**Tasks**
- [ ] Add `tests/lang/matrix/feature-toggles.json`.
- [ ] Add `tests/lang/<id>/toggle-matrix.test.js`:
  - tree‑sitter on/off
  - embeddings on/off
  - interprocedural on/off
- [ ] Document toggle effects in `docs/contracts/indexing.md`.

---

## Appendix P — Phase ownership + estimates

> Assign ownership and rough effort to avoid bottlenecks.

**Tasks**
- [ ] Add owner + effort columns to Appendix P tables:
  - Owner role: language SME / indexing SME / tooling SME
  - Effort: S/M/L
- [ ] Define “SME roster” in `docs/guides/commands.md` or internal doc.

---

## Appendix Q — Change‑control / update protocol

> When fixtures or expectations change, follow this exact protocol to avoid drift.

**Steps**
1. Run `node tests/run.js --lane lang-full`.
2. Update `tests/lang/fixtures/<id>/fixture-inventory.json` for touched languages.
3. Regenerate golden artifacts (Appendix I) and review diffs.
4. Update minimum counts in Appendix D if required.
5. Re‑run `lang-full` and confirm determinism.
6. Update schema versions (Appendix G) if any artifact schema changed.
7. Commit: include fixture + golden + matrix updates in one commit.

---

## Appendix R — Per‑phase acceptance gates (implementation)

> Enforce phase completion in CI or by explicit checklist steps.

**Tasks**
- [ ] Add `tools/lang/phase-gates.json` listing phase → required tests.
- [ ] Add `tests/lang/phase-gates.test.js` to validate gates list covers all tests.
- [ ] Add CI doc note describing how to verify phase completion.

---

## Appendix P — Per-phase per-language task tables

> Each phase includes a full per-language task table. Use these to assign parallel work with no ambiguity.

### P.1 Phase 0 — Foundations (matrix + contracts)

| Language | Tasks |
| --- | --- |
| javascript | Add matrix flags; map fixtures; expectations per Appendix B.1 |
| typescript | Add matrix flags; map fixtures; expectations per Appendix B.2 |
| python | Add matrix flags; map fixtures; expectations per Appendix B.3 |
| clike | Add matrix flags; map fixtures; expectations per Appendix B.4 |
| go | Add matrix flags; map fixtures; expectations per Appendix B.5 |
| java | Add matrix flags; map fixtures; expectations per Appendix B.6 |
| csharp | Add matrix flags; map fixtures; expectations per Appendix B.7 |
| kotlin | Add matrix flags; map fixtures; expectations per Appendix B.8 |
| ruby | Add matrix flags; map fixtures; expectations per Appendix B.9 |
| php | Add matrix flags; map fixtures; expectations per Appendix B.10 |
| html | Add matrix flags; map fixtures; expectations per Appendix B.11 |
| css | Add matrix flags; map fixtures; expectations per Appendix B.12 |
| lua | Add matrix flags; map fixtures; expectations per Appendix B.13 |
| sql | Add matrix flags; map fixtures; expectations per Appendix B.14 |
| perl | Add matrix flags; map fixtures; expectations per Appendix B.15 |
| shell | Add matrix flags; map fixtures; expectations per Appendix B.16 |
| rust | Add matrix flags; map fixtures; expectations per Appendix B.17 |
| swift | Add matrix flags; map fixtures; expectations per Appendix B.18 |
| cmake | Add matrix flags; map fixtures; expectations per Appendix B.19 |
| starlark | Add matrix flags; map fixtures; expectations per Appendix B.20 |
| nix | Add matrix flags; map fixtures; expectations per Appendix B.21 |
| dart | Add matrix flags; map fixtures; expectations per Appendix B.22 |
| scala | Add matrix flags; map fixtures; expectations per Appendix B.23 |
| groovy | Add matrix flags; map fixtures; expectations per Appendix B.24 |
| r | Add matrix flags; map fixtures; expectations per Appendix B.25 |
| julia | Add matrix flags; map fixtures; expectations per Appendix B.26 |
| handlebars | Add matrix flags; map fixtures; expectations per Appendix B.27 |
| mustache | Add matrix flags; map fixtures; expectations per Appendix B.28 |
| jinja | Add matrix flags; map fixtures; expectations per Appendix B.29 |
| razor | Add matrix flags; map fixtures; expectations per Appendix B.30 |
| proto | Add matrix flags; map fixtures; expectations per Appendix B.31 |
| makefile | Add matrix flags; map fixtures; expectations per Appendix B.32 |
| dockerfile | Add matrix flags; map fixtures; expectations per Appendix B.33 |
| graphql | Add matrix flags; map fixtures; expectations per Appendix B.34 |

### P.2 Phase 1 — Lane definition + ordering

| Language | Tasks |
| --- | --- |
| javascript | Add lang-full ordering entry; ensure JS block ordering |
| typescript | Add lang-full ordering entry; ensure TS block ordering |
| python | Add lang-full ordering entry; ensure Python block ordering |
| clike | Add lang-full ordering entry; ensure C/C++ block ordering |
| go | Add lang-full ordering entry; ensure Go block ordering |
| java | Add lang-full ordering entry; ensure Java block ordering |
| csharp | Add lang-full ordering entry; ensure CSharp block ordering |
| kotlin | Add lang-full ordering entry; ensure Kotlin block ordering |
| ruby | Add lang-full ordering entry; ensure Ruby block ordering |
| php | Add lang-full ordering entry; ensure PHP block ordering |
| html | Add lang-full ordering entry; ensure HTML block ordering |
| css | Add lang-full ordering entry; ensure CSS block ordering |
| lua | Add lang-full ordering entry; ensure Lua block ordering |
| sql | Add lang-full ordering entry; ensure SQL block ordering |
| perl | Add lang-full ordering entry; ensure Perl block ordering |
| shell | Add lang-full ordering entry; ensure Shell block ordering |
| rust | Add lang-full ordering entry; ensure Rust block ordering |
| swift | Add lang-full ordering entry; ensure Swift block ordering |
| cmake | Add lang-full ordering entry; ensure CMake block ordering |
| starlark | Add lang-full ordering entry; ensure Starlark block ordering |
| nix | Add lang-full ordering entry; ensure Nix block ordering |
| dart | Add lang-full ordering entry; ensure Dart block ordering |
| scala | Add lang-full ordering entry; ensure Scala block ordering |
| groovy | Add lang-full ordering entry; ensure Groovy block ordering |
| r | Add lang-full ordering entry; ensure R block ordering |
| julia | Add lang-full ordering entry; ensure Julia block ordering |
| handlebars | Add lang-full ordering entry; ensure Handlebars block ordering |
| mustache | Add lang-full ordering entry; ensure Mustache block ordering |
| jinja | Add lang-full ordering entry; ensure Jinja block ordering |
| razor | Add lang-full ordering entry; ensure Razor block ordering |
| proto | Add lang-full ordering entry; ensure Proto block ordering |
| makefile | Add lang-full ordering entry; ensure Makefile block ordering |
| dockerfile | Add lang-full ordering entry; ensure Dockerfile block ordering |
| graphql | Add lang-full ordering entry; ensure GraphQL block ordering |

### P.3 Phase 2 — Fixtures + indexing contract per language

| Language | Tasks |
| --- | --- |
| javascript | Build fixtures with ESM + CJS + React JSX (Appendix B.1) |
| typescript | Build fixtures with TSX + generics + types (Appendix B.2) |
| python | Build fixtures with decorators + async (Appendix B.3) |
| clike | Build fixtures with includes + macros (Appendix B.4) |
| go | Build fixtures with goroutines + interfaces (Appendix B.5) |
| java | Build fixtures with classes + lambdas (Appendix B.6) |
| csharp | Build fixtures with attributes + async (Appendix B.7) |
| kotlin | Build fixtures with data class + extensions (Appendix B.8) |
| ruby | Build fixtures with modules + blocks (Appendix B.9) |
| php | Build fixtures with traits + namespaces (Appendix B.10) |
| html | Build fixtures with DOM + script/style tags (Appendix B.11) |
| css | Build fixtures with selectors + @media (Appendix B.12) |
| lua | Build fixtures with tables + require (Appendix B.13) |
| sql | Build fixtures with DDL + CTE (Appendix B.14) |
| perl | Build fixtures with packages + regex (Appendix B.15) |
| shell | Build fixtures with source + pipes (Appendix B.16) |
| rust | Build fixtures with traits + lifetimes (Appendix B.17) |
| swift | Build fixtures with protocols + extensions (Appendix B.18) |
| cmake | Build fixtures with include + add_executable (Appendix B.19) |
| starlark | Build fixtures with load + rule (Appendix B.20) |
| nix | Build fixtures with import + let/in (Appendix B.21) |
| dart | Build fixtures with async + class (Appendix B.22) |
| scala | Build fixtures with object + trait (Appendix B.23) |
| groovy | Build fixtures with closures + class (Appendix B.24) |
| r | Build fixtures with library + function (Appendix B.25) |
| julia | Build fixtures with using + module (Appendix B.26) |
| handlebars | Build fixtures with partials + helpers (Appendix B.27) |
| mustache | Build fixtures with sections + vars (Appendix B.28) |
| jinja | Build fixtures with blocks + include (Appendix B.29) |
| razor | Build fixtures with directives + inline code (Appendix B.30) |
| proto | Build fixtures with messages + services (Appendix B.31) |
| makefile | Build fixtures with include + target (Appendix B.32) |
| dockerfile | Build fixtures with FROM + RUN + COPY (Appendix B.33) |
| graphql | Build fixtures with types + queries (Appendix B.34) |

### P.4 Phase 3 — AST + control/data flow

| Language | Tasks |
| --- | --- |
| javascript | AST/flow for JSX + generators; assert counts (Appendix C.1) |
| typescript | AST/flow for TSX + types; assert counts (Appendix C.2) |
| python | AST/flow for decorators + async (Appendix C.3) |
| clike | AST/flow for structs + templates (Appendix C.4) |
| go | AST/flow for goroutines (Appendix C.5) |
| java | AST/flow for lambdas (Appendix C.6) |
| csharp | AST/flow for attributes + async (Appendix C.7) |
| kotlin | AST/flow for data classes (Appendix C.8) |
| ruby | AST/flow for blocks (Appendix C.9) |
| php | AST/flow for traits (Appendix C.10) |
| html | Assert no AST; negative checks (Appendix H) |
| css | Assert no AST; negative checks (Appendix H) |
| lua | AST/flow for functions (Appendix C.13) |
| sql | AST/flow for statements if supported; else negative (Appendix H) |
| perl | AST/flow for subs (Appendix C.15) |
| shell | AST/flow for functions (Appendix C.16) |
| rust | AST/flow for traits + impls (Appendix C.17) |
| swift | AST/flow for protocols (Appendix C.18) |
| cmake | AST minimal; ensure chunking stable (Appendix C.19) |
| starlark | AST for load/rule if supported (Appendix C.20) |
| nix | AST for let/in if supported (Appendix C.21) |
| dart | AST/flow for async (Appendix C.22) |
| scala | AST/flow for trait/object (Appendix C.23) |
| groovy | AST/flow for closure (Appendix C.24) |
| r | AST minimal; assert chunking (Appendix C.25) |
| julia | AST minimal; assert chunking (Appendix C.26) |
| handlebars | no AST; template chunking (Appendix C.27) |
| mustache | no AST; template chunking (Appendix C.28) |
| jinja | no AST; template chunking (Appendix C.29) |
| razor | no AST; template chunking (Appendix C.30) |
| proto | AST for message/service if supported (Appendix C.31) |
| makefile | AST minimal; chunking (Appendix C.32) |
| dockerfile | AST minimal; chunking (Appendix C.33) |
| graphql | AST for schema if supported (Appendix C.34) |

### P.5 Phase 4 — Relations + graph artifacts

| Language | Tasks |
| --- | --- |
| javascript | import/require edges + symbol graph (Appendix C.1) |
| typescript | import type + symbol graph (Appendix C.2) |
| python | import/from edges (Appendix C.3) |
| clike | include edges (Appendix C.4) |
| go | import edges (Appendix C.5) |
| java | import edges (Appendix C.6) |
| csharp | using edges (Appendix C.7) |
| kotlin | import edges (Appendix C.8) |
| ruby | require edges (Appendix C.9) |
| php | use edges (Appendix C.10) |
| html | assert absent relations (Appendix H) |
| css | assert absent relations (Appendix H) |
| lua | require edges (Appendix C.13) |
| sql | relation edges optional; validate empties (Appendix H) |
| perl | use edges (Appendix C.15) |
| shell | source edges (Appendix C.16) |
| rust | use edges + symbol graph (Appendix C.17) |
| swift | import edges (Appendix C.18) |
| cmake | include edges (Appendix C.19) |
| starlark | load edges (Appendix C.20) |
| nix | import edges (Appendix C.21) |
| dart | import edges (Appendix C.22) |
| scala | import edges (Appendix C.23) |
| groovy | import edges (Appendix C.24) |
| r | library edges optional (Appendix C.25) |
| julia | using/import edges (Appendix C.26) |
| handlebars | assert absent relations (Appendix H) |
| mustache | assert absent relations (Appendix H) |
| jinja | assert absent relations (Appendix H) |
| razor | assert absent relations (Appendix H) |
| proto | import edges (Appendix C.31) |
| makefile | include edges (Appendix C.32) |
| dockerfile | assert absent relations (Appendix H) |
| graphql | assert absent relations (Appendix H) |

### P.6 Phase 5 — Risk pack + interprocedural gating

| Language | Tasks |
| --- | --- |
| javascript | local risk for eval/dynamic import; interproc if enabled |
| typescript | local risk for eval/dynamic import; interproc if enabled |
| python | local risk for eval/exec/subprocess |
| clike | local risk for system/strcpy |
| go | local risk for os/exec patterns |
| java | local risk for Runtime.exec |
| csharp | local risk for Process.Start |
| kotlin | local risk if supported; else assert absent |
| ruby | local risk if supported; else assert absent |
| php | local risk if supported; else assert absent |
| html | assert risk artifacts absent |
| css | assert risk artifacts absent |
| lua | local risk if supported; else assert absent |
| sql | assert risk artifacts absent |
| perl | local risk if supported; else assert absent |
| shell | local risk for exec patterns |
| rust | local risk for unsafe/exec patterns |
| swift | local risk if supported; else assert absent |
| cmake | assert risk artifacts absent |
| starlark | assert risk artifacts absent |
| nix | assert risk artifacts absent |
| dart | local risk if supported; else assert absent |
| scala | local risk if supported; else assert absent |
| groovy | local risk if supported; else assert absent |
| r | assert risk artifacts absent |
| julia | assert risk artifacts absent |
| handlebars | assert risk artifacts absent |
| mustache | assert risk artifacts absent |
| jinja | assert risk artifacts absent |
| razor | assert risk artifacts absent |
| proto | assert risk artifacts absent |
| makefile | assert risk artifacts absent |
| dockerfile | assert risk artifacts absent |
| graphql | assert risk artifacts absent |

### P.7 Phase 6 — API boundary + search filters

| Language | Tasks |
| --- | --- |
| javascript | search filters for JSX/React; API parity |
| typescript | search filters for TSX/types; API parity |
| python | search filters for defs/imports |
| clike | search filters for includes/symbols |
| go | search filters for funcs/types |
| java | search filters for classes/methods |
| csharp | search filters for classes/attributes |
| kotlin | search filters for classes/functions |
| ruby | search filters for modules/methods |
| php | search filters for classes/functions |
| html | search filters for tags/attrs |
| css | search filters for selectors |
| lua | search filters for functions |
| sql | search filters for tables/queries |
| perl | search filters for subs |
| shell | search filters for scripts |
| rust | search filters for traits/impls |
| swift | search filters for types/functions |
| cmake | search filters for targets |
| starlark | search filters for rules |
| nix | search filters for attrs |
| dart | search filters for classes/functions |
| scala | search filters for traits/objects |
| groovy | search filters for classes/closures |
| r | search filters for functions |
| julia | search filters for functions |
| handlebars | search filters for templates |
| mustache | search filters for templates |
| jinja | search filters for templates |
| razor | search filters for templates |
| proto | search filters for messages/services |
| makefile | search filters for targets |
| dockerfile | search filters for instructions |
| graphql | search filters for types/queries |

### P.8 Phase 7 — Determinism

| Language | Tasks |
| --- | --- |
| javascript | determinism test for JSX/React artifacts |
| typescript | determinism test for TSX/type artifacts |
| python | determinism test for imports/symbols |
| clike | determinism test for includes/symbols |
| go | determinism test for imports/symbols |
| java | determinism test for imports/symbols |
| csharp | determinism test for imports/symbols |
| kotlin | determinism test for imports/symbols |
| ruby | determinism test for relations |
| php | determinism test for relations |
| html | determinism test for docmeta |
| css | determinism test for docmeta |
| lua | determinism test for relations |
| sql | determinism test for docmeta |
| perl | determinism test for relations |
| shell | determinism test for relations |
| rust | determinism test for symbols |
| swift | determinism test for relations |
| cmake | determinism test for includes |
| starlark | determinism test for load edges |
| nix | determinism test for imports |
| dart | determinism test for relations |
| scala | determinism test for relations |
| groovy | determinism test for relations |
| r | determinism test for docmeta |
| julia | determinism test for docmeta |
| handlebars | determinism test for templates |
| mustache | determinism test for templates |
| jinja | determinism test for templates |
| razor | determinism test for templates |
| proto | determinism test for messages |
| makefile | determinism test for includes |
| dockerfile | determinism test for instructions |
| graphql | determinism test for schema |

### P.9 Phase 8 — CI wiring + reporting

| Language | Tasks |
| --- | --- |
| javascript | include in CI report + coverage tags |
| typescript | include in CI report + coverage tags |
| python | include in CI report + coverage tags |
| clike | include in CI report + coverage tags |
| go | include in CI report + coverage tags |
| java | include in CI report + coverage tags |
| csharp | include in CI report + coverage tags |
| kotlin | include in CI report + coverage tags |
| ruby | include in CI report + coverage tags |
| php | include in CI report + coverage tags |
| html | include in CI report + coverage tags |
| css | include in CI report + coverage tags |
| lua | include in CI report + coverage tags |
| sql | include in CI report + coverage tags |
| perl | include in CI report + coverage tags |
| shell | include in CI report + coverage tags |
| rust | include in CI report + coverage tags |
| swift | include in CI report + coverage tags |
| cmake | include in CI report + coverage tags |
| starlark | include in CI report + coverage tags |
| nix | include in CI report + coverage tags |
| dart | include in CI report + coverage tags |
| scala | include in CI report + coverage tags |
| groovy | include in CI report + coverage tags |
| r | include in CI report + coverage tags |
| julia | include in CI report + coverage tags |
| handlebars | include in CI report + coverage tags |
| mustache | include in CI report + coverage tags |
| jinja | include in CI report + coverage tags |
| razor | include in CI report + coverage tags |
| proto | include in CI report + coverage tags |
| makefile | include in CI report + coverage tags |
| dockerfile | include in CI report + coverage tags |
| graphql | include in CI report + coverage tags |

### P.10 Phase 9 — Dedup + shared harness

| Language | Tasks |
| --- | --- |
| javascript | use shared harness + expectations helper |
| typescript | use shared harness + expectations helper |
| python | use shared harness + expectations helper |
| clike | use shared harness + expectations helper |
| go | use shared harness + expectations helper |
| java | use shared harness + expectations helper |
| csharp | use shared harness + expectations helper |
| kotlin | use shared harness + expectations helper |
| ruby | use shared harness + expectations helper |
| php | use shared harness + expectations helper |
| html | use shared harness + expectations helper |
| css | use shared harness + expectations helper |
| lua | use shared harness + expectations helper |
| sql | use shared harness + expectations helper |
| perl | use shared harness + expectations helper |
| shell | use shared harness + expectations helper |
| rust | use shared harness + expectations helper |
| swift | use shared harness + expectations helper |
| cmake | use shared harness + expectations helper |
| starlark | use shared harness + expectations helper |
| nix | use shared harness + expectations helper |
| dart | use shared harness + expectations helper |
| scala | use shared harness + expectations helper |
| groovy | use shared harness + expectations helper |
| r | use shared harness + expectations helper |
| julia | use shared harness + expectations helper |
| handlebars | use shared harness + expectations helper |
| mustache | use shared harness + expectations helper |
| jinja | use shared harness + expectations helper |
| razor | use shared harness + expectations helper |
| proto | use shared harness + expectations helper |
| makefile | use shared harness + expectations helper |
| dockerfile | use shared harness + expectations helper |
| graphql | use shared harness + expectations helper |

---

