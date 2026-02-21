# AINTKNOWMAP

Canonical roadmap generated from a full audit of `FUTUREROADMAP.md`, rewritten for hard cutovers.

## Hard Cutover Policy

- One active behavior per surface. No compatibility shims, no dual-write/dual-read windows, no legacy mode.
- Optimization controls use one canonical profile selector with a default profile; temporary per-feature debug overrides are removed within the same phase that introduces them.
- Contract/schema changes are allowed to be breaking. When changed, update all producers/consumers in the same phase.
- CLI/API flag changes are allowed to be breaking. Remove retired flags/paths immediately.
- Toolchain requirements are strict. If a required toolchain is missing, fail fast with a clear error.
- Test and spec updates are mandatory in the same change as behavior changes.

## Spec and Test Rewrite Rules

- When functionality changes or improves:
  - update existing tests to assert new behavior
  - delete obsolete tests that only validate retired behavior
  - update existing specs/docs to match current behavior
- Do not preserve legacy wording or legacy contracts “for reference” in active docs.
- Superseded specs are moved to `docs/archived/` with a deprecation header (replacement, reason, date, commit/PR).

## Touchpoint Path Conventions

- Touchpoints list both existing files and planned-new files created in-phase.
- If a touchpoint path does not exist yet, treat it as planned creation work for that subphase.
- Wildcard touchpoints denote a bounded file family under the listed directory.

## Canonical source consolidation

This roadmap consolidates all duplicated sections in `FUTUREROADMAP.md` into one sequence:

- Release/platform work: merged from Phase 16 and Phase 18.
- TUI/supervisor work: merged from all three Phase 20 variants (first block, Appendix B/HAWKTUI, second block).
- Deferred async FS work is promoted to a required prerequisite before TUI/supervisor production rollout.
- NIKE phases 1-6 remain the core product hardening track and run before TUI/native cutovers.

## Canonical implementation order

### Phase 0 - Decision closure and canonicalization

Intent: remove ambiguity before code changes.

- [x] Resolve all open decisions in `FUTUREROADMAP.md` decision registers.
- [x] Declare canonical command/file names where duplicates exist:
  - [x] keep `tools/release/check.js` as canonical release runner
  - [x] keep one canonical test path per concern
- [x] Remove duplicate roadmap fragments from active planning docs and keep one authoritative sequence.
- [x] Enforce hard cutover policy in `AGENTS.md` roadmap process notes.

Verification:

- [x] `tests/tooling/docs/spec-links-valid.test.js`
- [x] `tests/tooling/docs/config-inventory-sync.test.js`

---

### Phase 0.5 - Language/framework indexing completeness and performance hardening

Intent: hard cutover to fully language-aware indexing, with no blind spots in extension routing, build/package manifests, or language-specific limits.

#### 0.5.0 Phase prelude: shared baselines and execution discipline

- [x] Execute Phase 0.5 in this order: `0.5.40` (descriptor + manifest canon) -> `0.5.41` (caps telemetry/calibration) -> `0.5.1..0.5.39e` (language/framework implementation passes) -> `0.5.42` (performance optimization program).
- [x] Enforce shared-file workstreams to reduce thrash: one routing/descriptor workstream, one caps workstream, one fixture/test workstream; each shared file is patched once per workstream, not repeatedly per language.
- [x] Enforce a concrete per-subphase implementation contract for every `0.5.x` language/framework section:
  - [ ] deliverable A: descriptor/spec patch (extensions, special filenames, parser route, adapter ID, caps profile)
  - [ ] deliverable B: code-path patch (routing + chunking + relations/flow/docmeta in listed touchpoints)
  - [ ] deliverable C: fixture/test patch (routing + collector/chunker/relation/flow + caps regression coverage)
- [x] Require each subphase commit series to include explicit artifact outputs (`descriptor diff`, `caps profile diff`, `fixture/test diff`) so validation work is always tied to concrete code changes.

Touchpoints:

- `src/index/constants.js`
- `src/index/build/discover.js`
- `src/index/language-registry/registry-data.js`
- `src/index/language-registry/registry.js`
- `src/index/build/runtime/caps.js`
- `tests/indexing/language-registry/*`
- `tests/indexing/chunking/*`

Execution contract reference: `docs/guides/phase-0.5-execution-contract.md`.

#### 0.5.1 JavaScript

- [x] Implement and enforce canonical JS source extension routing (`.js`, `.mjs`, `.cjs`) and remove any conflicting heuristics.
- [x] Implement and verify JS index build wiring end-to-end: collect imports, chunking, relations, control/data flow, doc metadata extraction.
- [x] Calibrate and commit JS `fileCaps` and tree-sitter thresholds from repo telemetry (token density, average LOC/file, p95 file size) and set strict defaults.


Touchpoints:

- `src/index/constants.js`
- `src/index/language-registry/registry-data.js`
- `src/index/language-registry/registry.js`
- `src/index/build/discover.js`
- `src/lang/javascript.js`
- `src/index/segments/jsx.js`
- `src/index/build/runtime/caps.js`
#### 0.5.2 TypeScript

- [x] Implement and enforce TS extension routing (`.ts`, `.mts`, `.cts`, declaration files where intentionally included/excluded).
- [x] Implement and verify TS index build wiring end-to-end, including type-centric relation extraction paths.
- [x] Calibrate and commit TS `fileCaps` and parse limits separately from JS based on TS verbosity and declaration-heavy files.


Touchpoints:

- `src/index/constants.js`
- `src/index/language-registry/registry-data.js`
- `src/index/language-registry/registry.js`
- `src/index/build/discover.js`
- `src/lang/typescript.js`
- `src/index/segments/jsx.js`
- `src/index/build/runtime/caps.js`
#### 0.5.3 JSX and TSX

- [x] Implement and verify `.jsx`/`.tsx` segmentation and parser routing as first-class code paths.
- [x] Enforce deterministic mixed-markup/chunk boundaries and relation extraction behavior.
- [x] Add strict caps tuned to high token density in component files.


Touchpoints:

- `src/index/constants.js`
- `src/index/language-registry/registry-data.js`
- `src/index/language-registry/registry.js`
- `src/index/build/discover.js`
- `src/index/segments/jsx.js`
- `src/lang/javascript.js`
- `src/lang/typescript.js`
- `src/index/chunking/dispatch.js`
- `src/index/build/runtime/caps.js`
#### 0.5.4 Vue

- [x] Implement and verify `.vue` segmentation across template/script/style blocks and ensure complete indexing of each embedded language segment.
- [x] Ensure relation/flow coverage includes both script setup and classic script blocks.
- [x] Calibrate and commit `.vue` caps to prevent under-indexing of large SFCs while guarding parse cost.


Touchpoints:

- `src/index/constants.js`
- `src/index/language-registry/registry-data.js`
- `src/index/language-registry/registry.js`
- `src/index/build/discover.js`
- `src/index/segments/vue.js`
- `src/index/segments/frontmatter.js`
- `src/index/chunking/dispatch.js`
- `src/index/build/runtime/caps.js`
#### 0.5.5 Svelte

- [x] Implement and verify `.svelte` segmentation and routing for script/context/style/template sections.
- [x] Ensure import/relation extraction covers both module and instance script contexts.
- [x] Calibrate and commit `.svelte` caps for component-heavy repos with large templating blocks.


Touchpoints:

- `src/index/constants.js`
- `src/index/language-registry/registry-data.js`
- `src/index/language-registry/registry.js`
- `src/index/build/discover.js`
- `src/index/segments/vue.js`
- `src/index/segments/frontmatter.js`
- `src/index/chunking/dispatch.js`
- `src/index/build/runtime/caps.js`
#### 0.5.6 Astro

- [x] Implement and verify `.astro` segmentation and embedded-language indexing fidelity.
- [x] Ensure imports/relations from frontmatter and embedded scripts are deterministic.
- [x] Calibrate and commit `.astro` caps for mixed markup/script payloads.


Touchpoints:

- `src/index/constants.js`
- `src/index/language-registry/registry-data.js`
- `src/index/language-registry/registry.js`
- `src/index/build/discover.js`
- `src/index/segments/vue.js`
- `src/index/segments/frontmatter.js`
- `src/index/chunking/dispatch.js`
- `src/index/build/runtime/caps.js`
#### 0.5.7 Python

- [x] Implement `.py` coverage plus package/module boundary handling for import graph extraction.
- [x] Implement and verify Python collector/chunker/relation/flow wiring and doc metadata extraction.
- [x] Calibrate and commit Python caps for high-LOC modules and verbose docstring-heavy files.


Touchpoints:

- `src/index/constants.js`
- `src/index/language-registry/registry-data.js`
- `src/index/language-registry/registry.js`
- `src/index/build/discover.js`
- `src/lang/python.js`
- `src/index/build/runtime/caps.js`
#### 0.5.8 Ruby

- [x] Implement `.rb` routing and module/class extraction behavior.
- [x] Implement and verify Ruby imports (`require`/`require_relative`) and relation modeling.
- [x] Calibrate and commit Ruby caps for DSL-heavy files and metaprogramming-heavy codebases.


Touchpoints:

- `src/index/constants.js`
- `src/index/language-registry/registry-data.js`
- `src/index/language-registry/registry.js`
- `src/index/build/discover.js`
- `src/lang/ruby.js`
- `src/index/build/runtime/caps.js`
#### 0.5.9 PHP

- [x] Implement `.php` routing and namespace/class/function extraction behavior.
- [x] Implement and verify import/usage extraction (`use`, include/require patterns) and relation wiring.
- [x] Calibrate and commit PHP caps for mixed HTML/PHP and framework-style monolith files.


Touchpoints:

- `src/index/constants.js`
- `src/index/language-registry/registry-data.js`
- `src/index/language-registry/registry.js`
- `src/index/build/discover.js`
- `src/lang/php.js`
- `src/index/build/runtime/caps.js`
#### 0.5.10 Lua

- [x] Implement `.lua` routing and module import extraction behavior.
- [x] Implement and verify chunk/relation extraction quality for table-heavy and script-style code.
- [x] Calibrate and commit Lua caps for plugin-style repos with large script bundles.


Touchpoints:

- `src/index/constants.js`
- `src/index/language-registry/registry-data.js`
- `src/index/language-registry/registry.js`
- `src/index/build/discover.js`
- `src/lang/lua.js`
- `src/index/build/runtime/caps.js`
#### 0.5.11 Perl

- [x] Implement `.pl`/`.pm` routing and package/module extraction coverage.
- [x] Implement and verify Perl import/require relation extraction.
- [x] Calibrate and commit Perl caps for legacy monolithic script styles.


Touchpoints:

- `src/index/constants.js`
- `src/index/language-registry/registry-data.js`
- `src/index/language-registry/registry.js`
- `src/index/build/discover.js`
- `src/lang/perl.js`
- `src/index/build/runtime/caps.js`
#### 0.5.12 Shell

- [x] Implement `.sh`, `.bash`, `.zsh` routing and shebang-aware indexing behavior.
- [x] Implement and verify shell include/source extraction and command relation heuristics.
- [x] Calibrate and commit shell caps for large deployment/CI scripts.


Touchpoints:

- `src/index/constants.js`
- `src/index/language-registry/registry-data.js`
- `src/index/language-registry/registry.js`
- `src/index/build/discover.js`
- `src/lang/shell.js`
- `src/index/build/runtime/caps.js`
#### 0.5.13 C and C++

- [x] Expand and enforce C/C++ extension coverage, including headers/modules (`.h`, `.hh`, `.hpp`, `.hxx`, `.c`, `.cc`, `.cpp`, `.cxx`, `.ipp`, `.ixx`, `.cppm`, `.tpp`, `.inl`, `.modulemap`).
- [x] Implement and verify include graph extraction and relation modeling for headers, sources, and module units.
- [x] Calibrate and commit C/C++ caps for large translation units and header-heavy repos.


Touchpoints:

- `src/index/constants.js`
- `src/index/language-registry/registry-data.js`
- `src/index/language-registry/registry.js`
- `src/index/build/discover.js`
- `src/lang/clike.js`
- `src/index/build/runtime/caps.js`
#### 0.5.14 Objective-C

- [x] Implement Objective-C coverage (`.m`, `.mm`, Objective-C headers) and routing through C-like pipelines.
- [x] Implement and verify import/include extraction across ObjC and ObjC++ files.
- [x] Calibrate and commit Objective-C caps for mixed UIKit/macOS codebases.


Touchpoints:

- `src/index/constants.js`
- `src/index/language-registry/registry-data.js`
- `src/index/language-registry/registry.js`
- `src/index/build/discover.js`
- `src/lang/clike.js`
- `src/index/build/runtime/caps.js`
#### 0.5.15 Go

- [x] Implement `.go` routing and package/import extraction behavior.
- [x] Implement and verify Go chunking/relations/flow extraction for multi-package repos.
- [x] Calibrate and commit Go caps for generated code and large monorepo package layouts.


Touchpoints:

- `src/index/constants.js`
- `src/index/language-registry/registry-data.js`
- `src/index/language-registry/registry.js`
- `src/index/build/discover.js`
- `src/lang/go.js`
- `src/index/build/runtime/caps.js`
#### 0.5.16 Java

- [x] Implement `.java` routing and class/interface/annotation extraction behavior.
- [x] Implement and verify package/import and relation extraction across deep package trees.
- [x] Calibrate and commit Java caps for verbose enterprise classes and generated sources.


Touchpoints:

- `src/index/constants.js`
- `src/index/language-registry/registry-data.js`
- `src/index/language-registry/registry.js`
- `src/index/build/discover.js`
- `src/lang/java.js`
- `src/index/build/runtime/caps.js`
#### 0.5.17 CSharp

- [x] Implement `.cs` routing and namespace/class/interface extraction behavior.
- [x] Implement and verify using/import relation extraction and partial-class handling.
- [x] Calibrate and commit C# caps for large solution codebases.


Touchpoints:

- `src/index/constants.js`
- `src/index/language-registry/registry-data.js`
- `src/index/language-registry/registry.js`
- `src/index/build/discover.js`
- `src/lang/csharp.js`
- `src/index/build/runtime/caps.js`
#### 0.5.18 Kotlin

- [x] Implement `.kt` and `.kts` routing and class/object/function extraction behavior.
- [x] Implement and verify import and relation extraction for multiplatform and Gradle Kotlin DSL usage.
- [x] Calibrate and commit Kotlin caps for coroutine-heavy and DSL-heavy files.


Touchpoints:

- `src/index/constants.js`
- `src/index/language-registry/registry-data.js`
- `src/index/language-registry/registry.js`
- `src/index/build/discover.js`
- `src/lang/kotlin.js`
- `src/index/build/runtime/caps.js`
#### 0.5.19 Rust

- [x] Implement `.rs` routing and module/use extraction behavior.
- [x] Implement and verify relation extraction across module trees and macro-heavy files.
- [x] Calibrate and commit Rust caps for macro-expanded and generated code patterns.


Touchpoints:

- `src/index/constants.js`
- `src/index/language-registry/registry-data.js`
- `src/index/language-registry/registry.js`
- `src/index/build/discover.js`
- `src/lang/rust.js`
- `src/index/build/runtime/caps.js`
#### 0.5.20 Swift

- [x] Implement `.swift` routing and type/function extraction behavior.
- [x] Implement and verify import and relation extraction for package and Xcode-style layouts.
- [x] Calibrate and commit Swift caps for protocol-heavy and extension-heavy files.


Touchpoints:

- `src/index/constants.js`
- `src/index/language-registry/registry-data.js`
- `src/index/language-registry/registry.js`
- `src/index/build/discover.js`
- `src/lang/swift.js`
- `src/index/build/runtime/caps.js`
#### 0.5.21 HTML

- [x] Implement `.html`/`.htm` routing and deterministic chunking behavior.
- [x] Implement and verify link/script/style reference extraction as relations where supported.
- [x] Calibrate and commit HTML caps for large template bundles.


Touchpoints:

- `src/index/constants.js`
- `src/index/language-registry/registry-data.js`
- `src/index/language-registry/registry.js`
- `src/index/build/discover.js`
- `src/lang/html.js`
- `src/index/chunking/dispatch.js`
- `src/index/build/runtime/caps.js`
#### 0.5.22 CSS

- [x] Implement `.css` routing and selector/token chunking behavior.
- [x] Implement and verify import and dependency relation extraction (`@import`, asset references).
- [x] Calibrate and commit CSS caps for large design-system stylesheets.


Touchpoints:

- `src/index/constants.js`
- `src/index/language-registry/registry-data.js`
- `src/index/language-registry/registry.js`
- `src/index/build/discover.js`
- `src/lang/css.js`
- `src/index/build/runtime/caps.js`
#### 0.5.23 Handlebars

- [x] Implement `.hbs`/`.handlebars` routing and template relation extraction behavior.
- [x] Implement and verify mixed template/code chunk boundaries.
- [x] Calibrate and commit Handlebars caps for server-rendered template repositories.


Touchpoints:

- `src/index/constants.js`
- `src/index/language-registry/registry-data.js`
- `src/index/language-registry/registry.js`
- `src/index/build/discover.js`
- `src/index/language-registry/import-collectors/handlebars.js`
- `src/index/language-registry/simple-relations.js`
- `src/index/build/runtime/caps.js`
#### 0.5.24 Mustache

- [x] Implement `.mustache` routing and template parse/chunk behavior.
- [x] Implement and verify section/partial relation extraction behavior.
- [x] Calibrate and commit Mustache caps for large template inventories.


Touchpoints:

- `src/index/constants.js`
- `src/index/language-registry/registry-data.js`
- `src/index/language-registry/registry.js`
- `src/index/build/discover.js`
- `src/index/language-registry/import-collectors/mustache.js`
- `src/index/language-registry/simple-relations.js`
- `src/index/build/runtime/caps.js`
#### 0.5.25 Jinja

- [x] Implement `.j2`/`.jinja`/`.jinja2` routing and template relation extraction behavior.
- [x] Implement and verify include/extend/import template relation modeling.
- [x] Calibrate and commit Jinja caps for backend template-heavy repos.


Touchpoints:

- `src/index/constants.js`
- `src/index/language-registry/registry-data.js`
- `src/index/language-registry/registry.js`
- `src/index/build/discover.js`
- `src/index/language-registry/import-collectors/jinja.js`
- `src/index/language-registry/simple-relations.js`
- `src/index/build/runtime/caps.js`
#### 0.5.26 Razor

- [x] Implement `.cshtml`/`.razor` routing and template-code segmentation behavior.
- [x] Implement and verify relation extraction from mixed Razor/C# surfaces.
- [x] Calibrate and commit Razor caps for componentized UI repositories.


Touchpoints:

- `src/index/constants.js`
- `src/index/language-registry/registry-data.js`
- `src/index/language-registry/registry.js`
- `src/index/build/discover.js`
- `src/index/language-registry/import-collectors/razor.js`
- `src/index/language-registry/simple-relations.js`
- `src/index/build/runtime/caps.js`
#### 0.5.27 SQL

- [x] Implement `.sql` routing and dialect-aware chunking behavior.
- [x] Implement and verify relation extraction for schema/table/function references where supported.
- [x] Calibrate and commit SQL caps for migration-heavy and warehouse-scale schema files.


Touchpoints:

- `src/index/constants.js`
- `src/index/language-registry/registry-data.js`
- `src/index/language-registry/registry.js`
- `src/index/build/discover.js`
- `src/lang/sql.js`
- `src/index/chunking/dispatch.js`
- `src/index/build/runtime/caps.js`
#### 0.5.28 GraphQL

- [x] Implement `.graphql`/`.gql` routing and operation/schema chunking behavior.
- [x] Implement and verify relation extraction for fragments, operations, and schema references.
- [x] Calibrate and commit GraphQL caps for large federated schemas.


Touchpoints:

- `src/index/constants.js`
- `src/index/language-registry/registry-data.js`
- `src/index/language-registry/registry.js`
- `src/index/build/discover.js`
- `src/index/language-registry/import-collectors/graphql.js`
- `src/index/chunking/dispatch.js`
- `src/index/build/runtime/caps.js`
#### 0.5.29 Proto

- [x] Implement `.proto` routing and message/service/import extraction behavior.
- [x] Implement and verify relation extraction across multi-file proto packages.
- [x] Calibrate and commit Proto caps for large generated-interface repos.


Touchpoints:

- `src/index/constants.js`
- `src/index/language-registry/registry-data.js`
- `src/index/language-registry/registry.js`
- `src/index/build/discover.js`
- `src/index/language-registry/import-collectors/proto.js`
- `src/index/chunking/dispatch.js`
- `src/index/build/runtime/caps.js`
#### 0.5.30 CMake

- [x] Implement `.cmake` and `CMakeLists.txt` routing.
- [x] Implement and verify target/dependency relation extraction for build graphs.
- [x] Calibrate and commit CMake caps for large multi-project build configurations.


Touchpoints:

- `src/index/constants.js`
- `src/index/language-registry/registry-data.js`
- `src/index/language-registry/registry.js`
- `src/index/build/discover.js`
- `src/index/language-registry/import-collectors/cmake.js`
- `src/index/build/runtime/caps.js`
#### 0.5.31 Starlark/Bazel

- [x] Implement `.bzl`, `BUILD`, `WORKSPACE`, and related Bazel file routing.
- [x] Implement and verify load/target relation extraction across Bazel module graphs.
- [x] Calibrate and commit Starlark/Bazel caps for monorepo-scale build definitions.


Touchpoints:

- `src/index/constants.js`
- `src/index/language-registry/registry-data.js`
- `src/index/language-registry/registry.js`
- `src/index/build/discover.js`
- `src/index/language-registry/import-collectors/starlark.js`
- `src/index/build/runtime/caps.js`
#### 0.5.32 Nix

- [x] Implement `.nix` routing and import/attribute extraction behavior.
- [x] Implement and verify relation extraction across flake/module boundaries.
- [x] Calibrate and commit Nix caps for large flake-based infra repositories.


Touchpoints:

- `src/index/constants.js`
- `src/index/language-registry/registry-data.js`
- `src/index/language-registry/registry.js`
- `src/index/build/discover.js`
- `src/index/language-registry/import-collectors/nix.js`
- `src/index/build/runtime/caps.js`
#### 0.5.33 Makefile

- [x] Implement `Makefile`/`makefile`/`GNUmakefile` routing and deterministic chunking.
- [x] Implement and verify target/include relation extraction for layered builds.
- [x] Calibrate and commit Makefile caps for generated and aggregate build files.


Touchpoints:

- `src/index/constants.js`
- `src/index/language-registry/registry-data.js`
- `src/index/language-registry/registry.js`
- `src/index/build/discover.js`
- `src/index/language-registry/import-collectors/makefile.js`
- `src/index/chunking/dispatch.js`
- `src/index/build/runtime/caps.js`
#### 0.5.34 Dockerfile

- [x] Implement `Dockerfile` and prefixed Dockerfile naming patterns routing.
- [x] Implement and verify stage/instruction chunking and dependency relation extraction.
- [x] Calibrate and commit Dockerfile caps for multi-stage enterprise images.


Touchpoints:

- `src/index/constants.js`
- `src/index/language-registry/registry-data.js`
- `src/index/language-registry/registry.js`
- `src/index/build/discover.js`
- `src/index/language-registry/import-collectors/dockerfile.js`
- `src/index/chunking/dispatch.js`
- `src/index/build/runtime/caps.js`
#### 0.5.35 Dart

- [x] Implement `.dart` routing and import/type relation extraction behavior.
- [x] Implement and verify chunking and relation extraction for Flutter and server Dart code.
- [x] Calibrate and commit Dart caps for generated model-heavy repositories.


Touchpoints:

- `src/index/constants.js`
- `src/index/language-registry/registry-data.js`
- `src/index/language-registry/registry.js`
- `src/index/build/discover.js`
- `src/index/language-registry/import-collectors/dart.js`
- `src/index/build/runtime/caps.js`
#### 0.5.36 Scala

- [x] Implement `.scala` routing and package/import/type extraction behavior.
- [x] Implement and verify relation extraction for trait/object/class-heavy code.
- [x] Calibrate and commit Scala caps for large Spark and backend codebases.


Touchpoints:

- `src/index/constants.js`
- `src/index/language-registry/registry-data.js`
- `src/index/language-registry/registry.js`
- `src/index/build/discover.js`
- `src/index/language-registry/import-collectors/scala.js`
- `src/index/build/runtime/caps.js`
#### 0.5.37 Groovy

- [x] Implement `.groovy` routing and import/class extraction behavior.
- [x] Implement and verify relation extraction for Gradle and runtime Groovy scripts.
- [x] Calibrate and commit Groovy caps for DSL and script-heavy build repos.


Touchpoints:

- `src/index/constants.js`
- `src/index/language-registry/registry-data.js`
- `src/index/language-registry/registry.js`
- `src/index/build/discover.js`
- `src/index/language-registry/import-collectors/groovy.js`
- `src/index/build/runtime/caps.js`
#### 0.5.38 R

- [x] Implement `.r` routing and function/source extraction behavior.
- [x] Implement and verify relation extraction for sourced scripts and package-style layouts.
- [x] Calibrate and commit R caps for analysis notebooks/scripts with long procedural files.


Touchpoints:

- `src/index/constants.js`
- `src/index/language-registry/registry-data.js`
- `src/index/language-registry/registry.js`
- `src/index/build/discover.js`
- `src/index/language-registry/import-collectors/r.js`
- `src/index/build/runtime/caps.js`
#### 0.5.39 Julia

- [x] Implement `.jl` routing and module/include extraction behavior.
- [x] Implement and verify relation extraction across package/module boundaries.
- [x] Calibrate and commit Julia caps for scientific code with long numeric kernels.


Touchpoints:

- `src/index/constants.js`
- `src/index/language-registry/registry-data.js`
- `src/index/language-registry/registry.js`
- `src/index/build/discover.js`
- `src/index/language-registry/import-collectors/julia.js`
- `src/index/build/runtime/caps.js`
#### 0.5.39a YAML

- [x] Implement `.yaml`/`.yml` routing and top-level/document-aware chunking behavior.
- [x] Implement and verify anchor/alias/include-style reference extraction behavior where supported.
- [x] Calibrate and commit YAML caps for large CI/deployment/config monoliths.


Touchpoints:

- `src/index/constants.js`
- `src/index/build/discover.js`
- `src/index/language-registry/registry-data.js`
- `src/index/chunking/formats/yaml.js`
- `src/index/chunking/dispatch.js`
- `src/index/build/file-processor/tree-sitter.js`
- `src/lang/tree-sitter/config.js`
- `src/lang/tree-sitter/native-runtime.js`
- `src/index/build/runtime/caps.js`
#### 0.5.39b JSON

- [x] Implement `.json` routing and deterministic structural chunking behavior.
- [x] Implement and verify key-path and reference-style relation extraction behavior where supported.
- [x] Calibrate and commit JSON caps for large generated manifests and lockfiles.


Touchpoints:

- `src/index/constants.js`
- `src/index/build/discover.js`
- `src/index/language-registry/registry-data.js`
- `src/index/chunking/formats/json.js`
- `src/index/chunking/dispatch.js`
- `src/index/build/file-processor/tree-sitter.js`
- `src/lang/tree-sitter/config.js`
- `src/lang/tree-sitter/native-runtime.js`
- `src/index/build/runtime/caps.js`
#### 0.5.39c TOML

- [x] Implement `.toml` routing and table/array-of-table chunking behavior.
- [x] Implement and verify dependency/config reference extraction behavior where supported.
- [x] Calibrate and commit TOML caps for large toolchain and package configuration files.


Touchpoints:

- `src/index/constants.js`
- `src/index/build/discover.js`
- `src/index/language-registry/registry-data.js`
- `src/index/chunking/formats/ini-toml.js`
- `src/index/chunking/dispatch.js`
- `src/index/build/file-processor/tree-sitter.js`
- `src/lang/tree-sitter/config.js`
- `src/lang/tree-sitter/native-runtime.js`
- `src/index/build/runtime/caps.js`
#### 0.5.39d INI

- [x] Implement `.ini`/`.cfg` routing and section/key chunking behavior.
- [x] Implement and verify include/reference extraction behavior where supported.
- [x] Calibrate and commit INI caps for legacy and infra configuration repositories.


Touchpoints:

- `src/index/constants.js`
- `src/index/build/discover.js`
- `src/index/language-registry/registry-data.js`
- `src/index/chunking/formats/ini-toml.js`
- `src/index/chunking/dispatch.js`
- `src/index/build/file-processor/tree-sitter.js`
- `src/lang/tree-sitter/config.js`
- `src/lang/tree-sitter/native-runtime.js`
- `src/index/build/runtime/caps.js`
#### 0.5.39e XML

- [x] Implement `.xml` routing and element/namespace-aware chunking behavior.
- [x] Implement and verify schema/import/include relation extraction behavior where supported.
- [x] Calibrate and commit XML caps for verbose build/config/schema files.


Touchpoints:

- `src/index/constants.js`
- `src/index/build/discover.js`
- `src/index/language-registry/registry-data.js`
- `src/index/chunking/formats/xml.js`
- `src/index/chunking/dispatch.js`
- `src/index/build/file-processor/tree-sitter.js`
- `src/lang/tree-sitter/config.js`
- `src/lang/tree-sitter/native-runtime.js`
- `src/lang/workers/tree-sitter-worker.js`
- `src/index/build/runtime/caps.js`
#### 0.5.40 Build/package manifest and special-file catalog

- [x] Expand `MANIFEST_FILES` / `LOCK_FILES` to full supported ecosystem coverage; current detection is still partial.
  - [x] JS/TS: `package.json`, lockfiles
  - [x] Python: `requirements.txt`, `pyproject.toml`, `Pipfile`, locks
  - [x] Ruby: `Gemfile`, `Gemfile.lock`
  - [x] PHP: `composer.json`, `composer.lock`
  - [x] Go: `go.mod`, `go.sum`
  - [x] Rust: `Cargo.toml`, `Cargo.lock`
  - [x] Java/Kotlin/Groovy/Scala: `pom.xml`, `build.gradle`, `build.gradle.kts`, `settings.gradle`, `settings.gradle.kts`
  - [x] C#: `.sln`, `.csproj`, `.props`, `.targets`, `Directory.Build.props`
  - [x] Swift: `Package.swift`, `Package.resolved`
  - [x] Dart: `pubspec.yaml`, `pubspec.lock`
  - [x] R: `DESCRIPTION`
  - [x] Julia: `Project.toml`, `Manifest.toml`
  - [x] C/C++/ObjC and infra: `CMakeLists.txt`, `Makefile`, `BUILD`, `WORKSPACE`, `Dockerfile`, `buf.yaml`, `buf.gen.yaml`, `flake.nix`
- [x] Define one canonical language descriptor contract (extensions, special filenames, parser route, adapter ID, caps profile) and treat it as the only editable source for language routing.
- [x] Generate extension/special-file tables and registry dispatch maps from the canonical language descriptor to eliminate manual drift across constants, discovery, and language registry modules.
- [x] Keep manifest/special-file logic singular across discovery, tooling helpers, and language catalog specs.
- [x] Add strict parity tests that assert manifest/special-file detection coverage for every supported ecosystem and special filename.


Touchpoints:

- `src/index/constants.js`
- `src/index/language-registry/registry-data.js`
- `src/index/language-registry/registry.js`
- `src/index/build/discover.js`
- `tools/usr/generate-usr-matrix-baselines.mjs`
- `tools/tooling/utils.js`
- `docs/specs/usr-language-descriptor-contract.md` (new)
- `docs/specs/usr-core-language-framework-catalog.md`
- `docs/specs/import-resolution.md`
#### 0.5.41 Language-specific limits calibration program

- [x] Build a language-by-language telemetry baseline (p50/p95/p99 bytes, lines, tokens, chunk counts, parse times).
- [x] Set strict per-language `maxBytes`/`maxLines`/tree-sitter thresholds from measured distributions instead of one global default.
- [x] Add per-language cap regression fixtures covering common real-world files and edge-case oversized files.
- [x] Emit deterministic calibration artifacts (`caps-calibration-inputs.json`, `caps-calibration-results.json`) and keep them versioned so cap updates are reproducible and reviewable.
- [x] Update `docs/specs/large-file-caps-strategy.md` and related contracts to reflect active language-aware behavior only.


Touchpoints:

- `src/index/build/runtime/caps.js`
- `src/index/build/file-processor/read.js`
- `src/index/build/file-processor/skip.js`
- `src/index/build/discover.js`
- `src/index/build/watch/guardrails.js`
- `benchmarks/index/caps-calibration-inputs.json` (new)
- `benchmarks/index/caps-calibration-results.json` (new)
- `docs/specs/large-file-caps-strategy.md`
#### 0.5.42 Index-build performance and optimization program (expert-level)

- [ ] Execute 0.5.42 in strict sequence:
  - [ ] sequence 0: instrumentation baseline, fixed fixture corpus lock, and reproducible benchmark harness
  - [ ] sequence 1: dispatch/scan/read hot-path acceleration and generated/vendor classification
  - [ ] sequence 2: parser lifecycle + fallback semantics
  - [ ] sequence 3: cache architecture + invalidation correctness
  - [ ] sequence 4: scheduler + memory-layout optimization
  - [ ] sequence 5: relation recomputation and memory-layout consolidation
  - [ ] sequence 6: profile consolidation and cleanup of temporary overrides
- [ ] Treat current early language resolution and current scan fastpath as baseline; harden and extend rather than re-implement.
- [ ] Capture baseline and post-change hot-path metrics from the identical fixture corpus so each optimization has attributable before/after impact.
- [ ] Implement hot-path timing probes first (scan/read/chunk/parse/relation) and freeze their event schema before optimization changes.
- [ ] Materialize phase artifacts for sequence 0 and reuse them unchanged for all later optimization sequences:
  - [ ] `benchmarks/index/perf-corpus-manifest.json`
  - [ ] `benchmarks/index/perf-baseline-telemetry.json`
  - [ ] `benchmarks/index/perf-after-telemetry.json`
  - [ ] `benchmarks/index/perf-delta-report.json`
- [ ] Replace per-file linear language registry lookup with a frozen extension/path-kind dispatch map built once at runtime init.
- [ ] Harden the existing two-tier scanner in `src/index/build/file-scan.js`:
  - [ ] tier 1: 4-8 KiB probe for binary/minified/generated heuristics
  - [ ] tier 2: bounded extended sample only when tier 1 is inconclusive
- [ ] Cache scan outcomes by `(path, size, mtimeMs)` for watch/rebuild runs to avoid re-scanning unchanged files.
- [ ] Implement generated-file classifier coverage (bundle/minified/vendor patterns) and route these files to low-cost metadata-only indexing by default.
- [ ] Define and enforce generated/vendor policy defaults:
  - [ ] default to metadata-only indexing for generated/minified/vendor files
  - [ ] allow explicit opt-in patterns for full indexing in repo config
  - [ ] emit deterministic reason metadata whenever downgraded indexing is applied
- [ ] Consolidate import-resolution manifest/package probes so discovery and import resolution consume one normalized manifest graph.
- [ ] Upgrade `readTextFileWithStreamingCap` to fixed-size chunk streaming with deterministic UTF-8 boundary handling and early cutover at cap.
- [ ] Reuse one shared line index and UTF-8 byte-prefix table per file across chunking, trimming, and relation span normalization.
- [ ] Replace repeated `Buffer.byteLength` scans in hot chunk splitting paths with cached prefix lookups.
- [ ] Add per-language chunk splitter specializations:
  - [ ] JS/TS/JSX/TSX: split by top-level declarations + export boundaries
  - [ ] C/C++/ObjC/Java/C#/Kotlin/Swift: split by type/function boundaries
  - [ ] SQL/GraphQL/Proto: split by statement/definition boundaries
- [ ] Add parser pools keyed by grammar in runtime workers with bounded pool size and eviction policy.
- [ ] Preload heavy grammars (JS/TS/C++/Rust/Java) during runtime bootstrap to eliminate first-file cold parse spikes.
- [ ] Add language-aware parse timeout scaling (size + line count + historical parse cost) instead of one static timeout.
- [ ] Add parse fallback modes:
  - [ ] tree-sitter AST mode (full)
  - [ ] syntax-lite mode (reduced extraction)
  - [ ] chunk-only mode for extreme files
- [ ] Align fallback behavior with a strict contract so downstream relation/explain/output behavior is deterministic in each fallback mode.
- [ ] Persist AST/chunk cache entries keyed by `(contentHash, languageId, runtimeKind, parserRuntimeVersion, parserVersion, grammarHash, nodeMajor, abiVersion, chunkingConfigVersion, fileCapsVersion, segmentationVersion, optionsHash)`.
- [ ] Define strict cache invalidation contract and apply it uniformly across warm memory cache and persistent cache stores.
- [ ] Enforce deterministic cache serialization ordering and checksum verification before cache reuse.
- [ ] Add block-level segment cache for Vue/Svelte/Astro so unchanged template/script/style blocks skip reparse.
- [ ] Add identical-content dedup across paths/worktrees to parse once and fan out reused chunk/AST artifacts.
- [ ] Add adaptive worker scheduler that prioritizes short files first, limits concurrent heavy-language parses, and preserves deterministic tie-break ordering (`priority bucket -> relPath -> contentHash`).
- [ ] Add work-stealing between workers with heavy-job backpressure to avoid one-worker long-tail stalls.
- [ ] Enforce deterministic writer commit order for chunks/relations/artifacts independent of worker completion timing.
- [ ] Add memory-pressure controls:
  - [ ] worker-level memory watermark and soft/hard pressure states
  - [ ] per-language concurrency throttles under pressure
  - [ ] deterministic cache eviction order (largest-first + oldest-first tie-break)
- [ ] Introduce symbol/string interning for relation graph construction to reduce duplicate allocations.
- [ ] Normalize cross-language symbol identity and edge typing before compression so graph consumers see one stable relation schema.
- [ ] Store relation edges in compact typed-array-backed buffers with delta-encoded positions instead of object-heavy maps.
- [ ] Add memory arena allocation strategy for transient chunk/relation objects to reduce GC churn in large builds.
- [ ] Add incremental relation recomputation for unchanged files by reusing prior stable relation snapshots.
- [ ] Add chunk-span lazy materialization path: carry `(start,end)` spans through processing and materialize raw substrings only at sinks that require concrete text.
- [ ] Fuse tokenization, minhash generation, and phrase/chargram extraction into a single streaming pass to reduce duplicate scans and transient allocations.
- [ ] Add deterministic chunk-embedding cache keyed by `(chunkHash, modelId, embeddingConfigVersion)` and skip recomputation for unchanged chunks.
- [ ] Add resumable index-build checkpoints (file cursor, artifact flush watermark, checkpoint checksum) so interrupted builds resume without replaying completed work.
- [ ] Add write-combining for postings/artifact writers with deterministic batched flush order to reduce small-write overhead.
- [ ] Add persistent tree-sitter query precompile cache keyed by `(languageId, grammarHash, querySetVersion)` to avoid repeat compile costs across runs.
- [ ] Add adaptive I/O concurrency controller (walk/read/stat lanes) driven by observed latency and memory pressure.
- [ ] Add path-string and chunk-name interning in artifact writers to reduce memory footprint and artifact size.
- [ ] Replace per-feature optimization toggles with one canonical `indexOptimizationProfile` selector (`default`, `throughput`, `memory-saver`) and keep `default` as the primary production path.
- [ ] Remove temporary experiment-only override knobs once profile behavior is stabilized in this phase.
- [ ] Enforce explicit profile semantics in contract validators so profile changes are schema-validated rather than doc-only.

Touchpoints:

- `src/index/constants.js`
- `src/index/language-registry/registry-data.js`
- `src/index/language-registry/registry.js`
- `src/index/build/discover.js`
- `src/index/build/file-scan.js`
- `src/index/build/file-processor/*`
- `src/index/chunking/*`
- `src/index/build/import-resolution/*`
- `src/index/build/runtime/tree-sitter.js`
- `src/index/build/tree-sitter-scheduler/*`
- `src/index/build/indexer/steps/process-files/tree-sitter.js`
- `src/index/build/file-processor/process-chunks/index.js`
- `src/lang/tree-sitter/native-runtime.js`
- `src/lang/workers/tree-sitter-worker.js`
- `src/index/build/runtime/caps.js`
- `src/index/build/tokenization.js`
- `src/index/build/postings/*`
- `src/index/build/indexer/steps/postings.js`
- `src/index/build/artifacts/write-concurrency.js`
- `src/index/build/state.js`
- `src/shared/packed-postings.js`
- `tools/tooling/utils.js`
- `benchmarks/index/perf-corpus-manifest.json` (new)
- `benchmarks/index/perf-baseline-telemetry.json` (new)
- `benchmarks/index/perf-after-telemetry.json` (new)
- `benchmarks/index/perf-delta-report.json` (new)
- `docs/specs/large-file-caps-strategy.md`
- `docs/specs/generated-vendor-indexing-policy.md`
- `docs/specs/indexing-fallback-semantics.md`
- `docs/specs/indexing-memory-pressure-policy.md`
- `docs/specs/index-optimization-profiles.md` (new)
- `docs/specs/index-checkpoint-resume.md` (new)
- `docs/specs/index-embedding-cache.md` (new)
- `docs/contracts/index-perf-contract.md` (new)
- `src/contracts/schemas/index-perf.js` (new)
- `src/contracts/validators/index-perf.js` (new)
- `docs/specs/import-resolution.md`
- `docs/specs/usr/languages/*`

Tests:

- [ ] Add/update language routing coverage tests that cover every supported language/framework and special filenames.
- [ ] Add/update per-language collector/chunker/relation/flow fixture tests for each registry entry.
- [ ] Add/update framework segmentation tests for Vue/Svelte/Astro/JSX/TSX with deterministic snapshots.
- [ ] Add/update manifest/build-file detection coverage tests across all supported ecosystems.
- [ ] Add/update per-language caps regression tests (`maxBytes`, `maxLines`, parser thresholds) driven by fixtures.
- [ ] Add/update fallback-mode behavior tests that assert deterministic downstream outputs for AST/syntax-lite/chunk-only modes.
- [ ] Add/update cache invalidation tests that assert stale cache rejection on parser/grammar/caps/segmentation changes.
- [ ] Add/update generated/vendor policy tests for metadata-only default and explicit opt-in full indexing.
- [ ] Add/update memory-pressure tests for watermark throttling and deterministic eviction order.
- [ ] Add/update indexing performance microbench suites (scan/read/chunk/parse/relation) with before/after measurements.
- [ ] Add/update performance artifact schema validation tests for `perf-*` outputs and `indexOptimizationProfile` contract enforcement.
- [ ] Add/update fused tokenization/minhash/chargram determinism and throughput tests.
- [ ] Add/update chunk-embedding cache reuse and invalidation tests.
- [ ] Add/update checkpoint-resume correctness and determinism tests.
- [ ] Add/update writer flush-order determinism tests.
- [ ] Add/update persistent query-precompile cache tests.
- [ ] Add/update adaptive I/O concurrency stability tests under mixed file-size workloads.

Exit criteria:

- [ ] Every supported language/framework has explicit, tested routing and index-build behavior.
- [ ] Header/class/source/build/package file coverage is complete and validated.
- [ ] Language-specific size/line/parse limits are calibrated from telemetry and enforced.
- [ ] Performance improvements are implemented with measurable before/after results.
- [ ] One canonical `indexOptimizationProfile` selector remains, with no temporary per-feature override flags left active.

---

### Phase 1 - Foundations and contract hygiene (NIKE Phase 1)

Intent: strict deterministic contracts and guardrails.

#### 1.1 Contract versioning and strict schema enforcement

- [x] Align active contract-versioning rules with existing release discipline and schema-version helpers.
- [x] Require strict schema validation for active versions.
- [x] Remove stale fields/spec clauses during the cutover, do not keep compatibility aliases.

Touchpoints:

- `docs/contracts/*`
- `docs/guides/release-discipline.md`
- `src/contracts/versioning.js`
- `src/contracts/schemas/*`
- `src/contracts/validators/*`

Tests:

- [x] Update contract parser tests to strict active-schema expectations.

#### 1.2 Path normalization policy (storage vs IO)

- [x] Enforce one canonical stored path format (`/` separators).
- [x] Enforce explicit normalization boundaries at IO edges.
- [x] Remove conflicting path-handling behaviors.

Touchpoints:

- `src/shared/files.js`
- `src/shared/path-normalize.js`
- `docs/guides/path-handling.md`
- `docs/contracts/*`

Tests:

- [x] Drive-letter, UNC, and POSIX normalization tests with strict expected outputs.

#### 1.3 Deterministic serialization and hashing

- [x] Enforce stable JSON ordering for all hashed artifacts.
- [x] Define canonical hash inputs and remove ambiguous fields.

Touchpoints:

- `src/shared/stable-json.js`
- `docs/contracts/*`

Tests:

- [x] Repeated-run hash stability tests.

#### 1.4 Spec contract consolidation

- [x] Harden the existing unified guardrail entrypoint (`tools/ci/run-suite.js`) and keep all contract checks registered through it.
- [x] Require each guardrail to define scope and remediation command.
- [x] Remove duplicated/overlapping guardrail checks.

Touchpoints:

- `tools/ci/run-suite.js`
- `tools/docs/contract-drift.js`
- `docs/tooling/script-inventory.json`
- `docs/guides/commands.md`

Tests:

- [x] Guardrail registry coverage test.

Exit criteria:

- [x] Active contracts are strict, deterministic, and fully tested.
- [x] Path and serialization policy is singular and enforced.
- [x] Guardrails are unified.

---

### Phase 2 - Release and platform baseline (merged Phase 16 + Phase 18)

Intent: deterministic releases, reproducible packaging, and strict platform behavior.

#### 2.1 Deterministic release-check

- [x] Keep `tools/release/check.js` canonical (current baseline: changelog + essential blockers), then extend it into full deterministic release validation.
- [x] Add `npm run release-check`.
- [x] Enforce fixed smoke sequence:
  - [x] `pairofcleats --version`
  - [x] fixture index build
  - [x] fixture index validate (`--strict`)
  - [x] fixture search
  - [x] editor package smoke checks
  - [x] service-mode smoke checks
- [x] Emit `release_check_report.json` with stable schema and ISO timestamps.
- [x] Emit `release-manifest.json` with checksums and artifact inventory.
- [x] Run contract/spec drift checks as part of release-check flow before smoke steps.
- [x] Remove permissive modes that skip required checks.

Tests:

- [x] `tests/tooling/release-check/smoke.test.js`
- [x] `tests/tooling/release-check/report-schema.test.js`
- [x] `tests/tooling/release-check/exit-codes.test.js`
- [x] `tests/tooling/release-check/deterministic-order.test.js`


Touchpoints:

- `tools/release/check.js`
- `tools/docs/contract-drift.js`
- `package.json`
- `docs/guides/release-discipline.md`
#### 2.2 Cross-platform path safety

- [x] Audit release-critical path joins and normalization.
- [x] Replace brittle concatenation with path-safe helpers.
- [x] Enforce path behavior for spaces, drive letters, mixed separators, UNC.

Tests:

- [x] `tests/tooling/paths/paths-with-spaces.test.js`
- [x] `tests/tooling/paths/windows-paths-smoke.test.js`
- [x] `tests/tooling/paths/path-edge-cases.test.js`
- [x] `tests/tooling/paths/windows-drive-letter-normalization.test.js`
- [x] `tests/tooling/paths/mixed-separators-cli.test.js`


Touchpoints:

- `src/shared/files.js`
- `src/shared/path-normalize.js`
- `src/shared/io/atomic-write.js`
- `docs/guides/path-handling.md`
#### 2.3 Reproducible editor packaging

- [x] Implement deterministic Sublime packaging (`tools/package-sublime.js`).
- [x] Implement deterministic VS Code packaging (`tools/package-vscode.js`).
- [x] Enforce deterministic archive layout rules (stable entry ordering, normalized root prefix, normalized path separators).
- [x] Normalize archive metadata (`mtime`, `uid/gid`, mode bits) and enforce fixed compression method/level for reproducible outputs across hosts.
- [x] Emit and verify per-archive checksum manifests during packaging runs.
- [x] Enforce pinned packaging toolchains.
- [x] Fail packaging jobs when required toolchains are unavailable.
- [x] Update editor integration docs to reflect active packaging flow.

Tests:

- [x] `tests/tooling/sublime/package-structure.test.js`
- [x] `tests/tooling/sublime/package-determinism.test.js`
- [x] `tests/tooling/vscode/extension-packaging.test.js`
- [x] `tests/tooling/vscode/vscode-extension.test.js` (updated)
- [x] Create `tests/tooling/vscode/toolchain-missing-policy.test.js` with strict missing-toolchain failure expectations.
- [x] `tests/tooling/sublime/package-archive-metadata.test.js` (new)
- [x] `tests/tooling/vscode/package-archive-metadata.test.js` (new)


Touchpoints:

- `tools/package-sublime.js` (new)
- `tools/package-vscode.js` (new)
- `tools/tooling/archive-determinism.js` (new)
- `docs/specs/editor-packaging-determinism.md` (new)
- `docs/guides/editor-integration.md`
- `extensions/`
- `sublime/`
#### 2.4 Python toolchain policy

- [x] Decide and document whether Python is a required runtime dependency for local tooling flows.
- [x] If required, enforce preflight failure when missing.
- [x] Remove skip-based semantics from core tooling paths.
- [x] Keep optional best-effort behavior only in explicitly optional commands.

Tests:

- [x] Update `tests/tooling/sublime/sublime-pycompile.test.js` for strict policy.
- [x] Update Python tooling tests to reflect required-toolchain behavior.


Touchpoints:

- `docs/guides/release-discipline.md`
- `docs/guides/commands.md`
- `tests/tooling/sublime/sublime-pycompile.test.js`
- `package.json`
#### 2.5 Service-mode bundle and enforcement

- [x] Define canonical one-command service-mode run path.
- [x] Document required env, queue paths, and security defaults.
- [x] Make service-mode smoke part of standard release validation flow.

Tests:

- [x] `tests/services/service-mode-smoke.test.js`


Touchpoints:

- `tools/service/indexer-service.js`
- `tools/service/config.js`
- `docs/guides/service-mode.md`
- `tests/services/service-mode-smoke.test.js` (new)

Exit criteria:

- [x] Release-check and platform safety behaviors are deterministic and enforced.
- [x] Packaging and service-mode checks are mandatory in standard release validation.

---

### Phase 3 - Index artifact robustness (NIKE Phase 2)

Intent: deterministic artifact writing with strict validators.

#### 3.1 Deterministic trimming policy

- [x] Add a shared trimming helper and use it across writers.
- [x] Define one deterministic trim order.
- [x] Emit trim counters in stats.
- [x] Emit trim policy metadata required by contract (`trimPolicyVersion`, `trimReasonCounts`, deterministic reason taxonomy).
- [x] Align writer outputs with `docs/contracts/artifact-trimming-policy.md` and schema index references.

Touchpoints:

- `src/index/build/artifacts/writers/call-sites.js`
- `src/index/build/artifacts/writers/*`
- `src/index/build/artifacts/reporting.js`
- `src/index/build/artifacts-write.js`
- `src/contracts/schemas/artifacts.js`
- `docs/contracts/artifact-trimming-policy.md`
- `docs/contracts/artifact-schema-index.json`

Tests:

- [x] Oversized-row trim determinism tests per writer.
- [x] Required-field invariants after trim.
- [x] Trim counter emission tests.

#### 3.2 Determinism report

- [x] Emit `determinism_report.json` with source reasons.
- [x] Update validators to require this artifact where configured.
- [x] Remove ambiguous nondeterministic-field handling.

Touchpoints:

- `src/index/build/state.js`
- `src/index/validate/*`
- `docs/testing/index-state-nondeterministic-fields.md`
- `docs/specs/build-state-integrity.md`

Tests:

- [x] Determinism report schema and emission tests.

Exit criteria:

- [x] Trim and determinism behaviors are strict and validator-enforced.

---

### Phase 4 - Search/graph UX and explain contract (NIKE Phase 3)

Intent: deterministic output contracts and strict behavior.

#### 4.1 Search startup performance

- [x] Harden existing startup checkpoint reporting (`startup.backend`, `startup.search`) and freeze deterministic stage schema.
- [x] Remove slow init paths from `search --help` and search fast paths.

Touchpoints:

- `src/retrieval/cli/run-search.js`
- `src/retrieval/cli/search-execution.js`
- `src/retrieval/pipeline/stage-checkpoints.js`
- `docs/guides/search.md`

Tests:

- [x] Startup checkpoint ordering test.
- [x] Search help fastpath test.

#### 4.2 Explain schema normalization

- [x] Define strict explain schema with explicit version.
- [x] Enforce deterministic field ordering.
- [x] Remove stale explain fields and docs.

Touchpoints:

- `src/retrieval/output/explain.js`
- `src/retrieval/pipeline/graph-ranking.js`
- `docs/contracts/retrieval-ranking.md`
- `docs/contracts/search-contract.md`

Tests:

- [x] Explain schema validation tests.
- [x] Explain snapshot updates.

#### 4.3 Graph ranking controls

- [x] Keep one `--graph-ranking` behavior.
- [x] Enforce membership invariant strictly.

Touchpoints:

- `src/retrieval/cli-args.js`
- `src/retrieval/cli/normalize-options.js`
- `src/retrieval/pipeline/graph-ranking.js`
- `docs/contracts/search-cli.md`

Tests:

- [x] Graph ranking toggle tests.
- [x] Membership invariant tests.

#### 4.4 Search output overhaul

- [x] Implement deterministic human output modes.
- [x] Implement strict JSON output contract with version field.
- [x] Gate heavy fields explicitly and remove ambiguous defaults.

Touchpoints:

- `src/retrieval/output/format.js`
- `src/retrieval/output/summary.js`
- `src/retrieval/output/context.js`
- `docs/guides/search.md`

Tests:

- [x] Human and JSON snapshot updates.
- [x] Deterministic ordering tests.

#### 4.5 Impact analysis strictness

- [x] Enforce strict empty-input behavior with stable error code.
- [x] Remove permissive empty-input behavior.

Touchpoints:

- `src/graph/impact.js`
- `src/integrations/tooling/impact.js`
- `docs/contracts/graph-tools-cli.md`

Tests:

- [x] Strict empty-input error tests.

Exit criteria:

- [x] Search/graph behaviors are strict, deterministic, and reflected in updated specs/tests.

---

### Phase 5 - SCM contract and workspace scaffolding (NIKE Phase 4)

Intent: strict SCM/workspace contracts and deterministic manifests.

#### 5.1 SCM provider contract

- [x] Define strict provider return contracts for git/jj.
- [x] Enforce deterministic failure behavior for unavailable SCM.
- [x] Remove inconsistent provider edge behavior.

Touchpoints:

- `src/index/scm/providers/git.js`
- `src/index/scm/providers/jj.js`
- `docs/specs/scm-provider-contract.md`
- `docs/specs/scm-provider-config-and-state-schema.md`

Tests:

- [x] Provider shape tests.
- [x] Unavailable-SCM deterministic failure tests.

#### 5.2 Workspace manifest/config

- [x] Enforce strict schema validation for workspace config/manifest.
- [x] Emit deterministic `workspace_manifest.json`.
- [x] Document one canonical emission flow.

Touchpoints:

- `docs/specs/workspace-config.md`
- `docs/specs/workspace-manifest.md`
- `src/contracts/schemas/*`
- `src/shared/workspace/*`

Tests:

- [x] Workspace schema validation tests.
- [x] Manifest determinism tests.

Exit criteria:

- [x] SCM/workspace contracts are strict and deterministic.

---

### Phase 6 - Test runner, coverage, profiling (NIKE Phase 5)

Intent: strict test telemetry and profiling contracts.

#### 6.1 Timings ledger and watchdog

- [x] Harden existing `--log-times` / `--timings-file` output into a versioned schema with strict field guarantees.
- [x] Add hung-test watchdog with enforced behavior.

Touchpoints:

- `tests/run.js`
- `tests/runner/*`
- `.testLogs/*`
- `docs/testing/test-runner-interface.md`
- `docs/testing/ci-capability-policy.md`

Tests:

- [x] Runner format/path tests.
- [x] Watchdog behavior tests.

#### 6.2 Coverage integration

- [x] Implement `--coverage`, `--coverage-merge`, and `--coverage-changed` in `tests/run.js`.
- [x] Define a versioned coverage artifact schema and deterministic merge ordering (normalized repo-relative `/` paths + stable file ordering).
- [x] Enforce coverage artifact schema validation in contract validators (not docs only).
- [x] Enforce documented output locations and schema.
- [x] Normalize all coverage paths before write/merge to eliminate platform-dependent path drift.

Touchpoints:

- `tests/run.js`
- `tools/testing/coverage/*` (new)
- `src/shared/path-normalize.js`
- `docs/contracts/test-coverage-contract.md` (new)
- `src/contracts/schemas/test-artifacts.js` (new)
- `src/contracts/validators/test-artifacts.js` (new)
- `.c8/` (new)

Tests:

- [x] Coverage flag parsing tests.
- [x] Coverage merge tests.
- [x] Coverage path-normalization determinism tests.
- [x] Coverage artifact schema validation tests.

#### 6.3 Profiling hooks

- [x] Implement and enforce `--profile` output contract in the test runner.
- [x] Emit deterministic `profile.json` schema with explicit version, normalized path fields, fixed time units, and stable key ordering.
- [x] Enforce profile artifact schema validation in contract validators (not docs only).
- [x] Enforce deterministic numeric formatting/rounding for timing fields to avoid host-dependent serialization drift.

Touchpoints:

- `tests/run.js`
- `src/index/build/runtime/runtime.js`
- `src/retrieval/pipeline.js`
- `src/retrieval/output/summary.js`
- `src/shared/path-normalize.js`
- `docs/contracts/test-profile-contract.md` (new)
- `src/contracts/schemas/test-artifacts.js` (new)
- `src/contracts/validators/test-artifacts.js` (new)
- `docs/perf/*`

Tests:

- [x] Profile artifact contract tests.
- [x] Profile path/time normalization determinism tests.
- [x] Profile artifact schema validation tests.

Exit criteria:

- [x] Runner/coverage/profile outputs are stable and documented.

---

### Phase 7 - CLI ingest wrappers and error telemetry (NIKE Phase 6)

Intent: strict CLI routing and error-code consistency.

#### 7.1 Ingest CLI wrappers

- [x] Add and enforce `pairofcleats ingest <ctags|gtags|lsif|scip>` routes in `bin/pairofcleats.js` (current ingest scripts are separate commands).
- [x] Update ingest docs and command inventory.

Touchpoints:

- `bin/pairofcleats.js`
- `tools/ingest/ctags.js`
- `tools/ingest/gtags.js`
- `tools/ingest/lsif.js`
- `tools/ingest/scip.js`
- `docs/tooling/ctags.md`
- `docs/tooling/gtags.md`
- `docs/tooling/lsif.md`
- `docs/tooling/scip.md`
- `docs/guides/commands.md`

Tests:

- [x] CLI routing tests per ingest tool.

#### 7.2 Error telemetry consistency

- [x] Enforce one error code registry and namespace strategy.
- [x] Attach `code + hint` consistently across CLI/API/MCP error payloads.

Touchpoints:

- `src/shared/error-codes.js`
- `tools/api/router/*`
- `src/integrations/mcp/*`
- `src/retrieval/output/*`

Tests:

- [x] API/MCP/CLI error contract tests.

Exit criteria:

- [x] Ingest and error telemetry surfaces are strict and uniform.

---

### Phase 8 - Async request-path FS completion (promoted from Deferred)

Intent: eliminate sync FS from request-time paths with one strict signature flow.

- [ ] Keep the now-async signature path as baseline and remove remaining sync request-time artifact reads.
- [ ] Replace sync loaders in request path (`loadJsonArrayArtifactSync`, sync file existence probes) with async equivalents.
- [ ] Ensure one signature strategy keyed by `index_state.json` + deterministic cache policy.
- [ ] Remove redundant signature/read branches across retrieval/tooling entrypoints.

Tests:

- [ ] No-sync-FS request-path tests (including async artifact loader usage in retrieval startup path).
- [ ] Signature invalidation tests.

Touchpoints:

- `src/retrieval/index-cache.js`
- `src/retrieval/cli/index-loader.js`
- `src/retrieval/cli/load-indexes.js`
- `src/retrieval/cli/run-search-session.js`
- `src/shared/artifact-io/loaders/core.js`
- `src/integrations/tooling/*`
- `docs/specs/signature.md`

Exit criteria:

- [ ] Request-time signature and artifact-read path is async-only and deterministic.

---

### Phase 9 - Unified terminal-owned TUI and Node supervisor (merged all Phase 20 variants)

Intent: strict protocol boundary and deterministic orchestration.

#### 9.0 Preparation: tool contract and kill-tree unification

- [x] Reconcile and freeze `docs/specs/tui-tool-contract.md` against actual supervisor/tool behavior.
- [x] Bootstrap missing TUI/supervisor scaffolding directories (`tools/tui/`, `tests/tui/`) and command wrapper entrypoints.
- [x] Enforce stdout/stderr contracts for all supervisor-driven tools.
- [x] Add shared kill-tree helper (`src/shared/kill-tree.js`) and replace fragmented implementations.
- [x] Add stdout guard (`src/shared/cli/stdout-guard.js`).

Tests:

- [x] `tests/shared/kill-tree.posix.test.js`
- [x] `tests/shared/kill-tree.windows.test.js`
- [x] `tests/tooling/install/setup-json-output.test.js`
- [x] `tests/tooling/install/bootstrap-json-output.test.js`


Touchpoints:

- `docs/specs/tui-tool-contract.md`
- `src/shared/kill-tree.js` (new)
- `src/shared/cli/stdout-guard.js` (new)
- `src/shared/cli/progress-events.js`
- `src/shared/subprocess.js`
#### 9.1 Protocol v2, context propagation, shared decoder

- [x] Reconcile `docs/specs/progress-protocol-v2.md` with runtime implementation and enforce it strictly in code.
- [x] Enforce strict `proto: "poc.progress@2"` event parsing.
- [x] Add `PAIROFCLEATS_PROGRESS_CONTEXT` propagation.
- [x] Implement `src/shared/cli/progress-stream.js` with strict line framing and size cap.

Touchpoints:

- `src/shared/cli/progress-events.js`
- `src/shared/progress.js`
- `src/shared/cli/display.js`
- `src/shared/env.js`
- `src/integrations/mcp/protocol.js`
- `src/integrations/mcp/defs.js`

Tests:

- [x] `tests/tui/protocol-v2-schema.test.js`
- [x] `tests/tui/protocol-v2-ordering.test.js`
- [x] parser/decoder/context propagation tests

#### 9.2 Node supervisor lifecycle model

- [x] Use `docs/specs/node-supervisor-protocol.md` as canonical target and implement the missing supervisor runtime.
- [x] Implement `tools/tui/supervisor.js` with strict lifecycle states.
- [x] Enforce deterministic cancellation and child cleanup.
- [x] Emit structured lifecycle events.

Tests:

- [x] `tests/tui/supervisor-lifecycle-state-machine.test.js`
- [x] `tests/tui/supervisor-retry-policy.test.js`
- [x] supervisor stream discipline and cancellation integration tests


Touchpoints:

- `docs/specs/node-supervisor-protocol.md`
- `tools/tui/supervisor.js` (new)
- `src/shared/subprocess.js`
- `src/shared/progress.js`
#### 9.3 Dispatch reconciliation and artifact indexing pass

- [x] Implement dispatcher rewrite per `docs/specs/dispatcher-rewrite-and-search-reconciliation.md`.
- [x] Remove brittle search allowlists; keep one strict search argument surface.
- [x] Implement shared dispatch modules:
  - `src/shared/dispatch/registry.js`
  - `src/shared/dispatch/manifest.js`
  - `src/shared/dispatch/resolve.js`
  - `src/shared/dispatch/env.js`
- [x] Implement artifact pass per `docs/specs/supervisor-artifacts-indexing-pass.md` and emit `job:artifacts`.

Tests:

- [x] `tests/dispatch/manifest-list.test.js`
- [x] `tests/dispatch/manifest-describe-search.test.js`
- [x] artifact indexing and search passthrough tests


Touchpoints:

- `docs/specs/dispatcher-rewrite-and-search-reconciliation.md`
- `docs/specs/supervisor-artifacts-indexing-pass.md`
- `bin/pairofcleats.js`
- `src/shared/dispatch/registry.js` (new)
- `src/shared/dispatch/manifest.js` (new)
- `src/shared/dispatch/resolve.js` (new)
- `src/shared/dispatch/env.js` (new)
#### 9.4 Rust Ratatui TUI MVP

- [x] Create `crates/pairofcleats-tui/` skeleton.
- [x] Implement supervisor handshake/run/cancel/shutdown integration.
- [x] Implement deterministic jobs/tasks/logs UI model.
- [x] Guarantee terminal restoration on normal and error exits.
- [x] Pin Rust toolchain + crate dependency versions and enforce lockfile-based reproducible builds.
- [x] Define deterministic target-triple to artifact-name mapping used by build, install, and wrapper resolution paths.
- [x] Integrate cross-platform TUI build flow in release tooling so produced artifacts/checksums are generated from one canonical pipeline.
- [x] Wire Node-side command and release integration for TUI build/install flows (command registry, package scripts, release-check inclusion).

Tests:

- [x] Rust protocol decode tests
- [x] headless smoke test
- [x] cancel path integration
- [x] rendering responsiveness tests
- [x] target-triple artifact naming tests
- [x] toolchain pin/lockfile enforcement tests


Touchpoints:

- `crates/pairofcleats-tui/` (new)
- `crates/pairofcleats-tui/Cargo.toml` (new)
- `crates/pairofcleats-tui/rust-toolchain.toml` (new)
- `docs/specs/node-supervisor-protocol.md`
- `docs/specs/progress-protocol-v2.md`
- `docs/specs/tui-build-and-release.md` (new)
- `tools/tui/build.js` (new)
- `tools/release/check.js`
- `package.json`
- `docs/guides/commands.md`
- `bin/pairofcleats.js`
- `bin/pairofcleats-tui.js` (new)
#### 9.5 Cancellation and never-hang guarantees

- [x] Propagate cancellation/deadlines through all stages.
- [x] Enforce bounded shutdown and watchdog behavior.
- [x] Eliminate orphan process scenarios.

Tests:

- [x] ignore-SIGTERM fixture
- [x] UI termination mid-job fixture
- [x] `tests/tui/cancel-propagation.test.js`


Touchpoints:

- `tools/tui/supervisor.js` (new)
- `src/shared/subprocess.js`
- `src/shared/abort.js`
- `src/shared/progress.js`
#### 9.6 Install/distribution and observability

- [x] Implement deterministic TUI install and wrapper flow:
  - `bin/pairofcleats-tui.js`
  - `tools/tui/install.js`
- [x] Define one canonical target manifest consumed by build, installer, and wrapper resolution.
- [x] Publish deterministic binaries and checksums for supported targets.
- [x] Implement and verify checksum and executable metadata before wrapper launch.
- [x] Fail wrapper with actionable error when binary is missing/invalid.
- [x] Enforce deterministic install layout/cache policy (stable directories, file naming, cleanup semantics).
- [x] Add replayable event logs and run correlation.
- [x] Add/update TUI docs:
  - `docs/specs/tui-installation.md`
  - `docs/guides/tui.md`

Tests:

- [x] installer unit tests
- [x] wrapper behavior tests
- [x] `tests/tui/observability/session-correlation.test.js`
- [x] `tests/tui/observability/replay-determinism.test.js`

Touchpoints:

- `bin/pairofcleats-tui.js` (new)
- `tools/tui/install.js` (new)
- `tools/tui/targets.json` (new)
- `docs/specs/tui-installation.md`
- `docs/guides/tui.md`
- `tests/tui/observability/` (new)

#### 9.7 TUI runtime throughput and interaction latency hardening

- [x] Implement supervisor-to-TUI credit-based backpressure with bounded queues and deterministic coalesce/drop policy under overload.
- [x] Implement viewport virtualization for jobs/tasks/log panes with ring-buffer retention and deterministic truncation semantics.
- [x] Implement frame scheduler with fixed render budget and dirty-region diff rendering to cap CPU under high event volume.
- [x] Implement oversized event/log payload chunking with deterministic reassembly and overflow behavior.
- [x] Implement persistent session snapshot/recovery (`last-state.json`) so TUI restores prior view state after restart.
- [x] Implement terminal capability negotiation (color/unicode/mouse/alt-screen) with deterministic degraded rendering modes.
- [x] Implement input throttling/debouncing for high key-repeat scenarios with deterministic command dispatch ordering.
- [x] Add in-TUI performance telemetry (event lag, render time, queue depth) and emit structured runtime metrics.

Tests:

- [x] `tests/tui/backpressure-credit-protocol.test.js` (new)
- [x] `tests/tui/list-virtualization-determinism.test.js` (new)
- [x] `tests/tui/frame-budget-under-load.test.js` (new)
- [x] `tests/tui/oversized-event-chunking.test.js` (new)
- [x] `tests/tui/session-snapshot-recovery.test.js` (new)
- [x] `tests/tui/terminal-capability-fallback.test.js` (new)
- [x] `tests/tui/input-throttle-ordering.test.js` (new)

Touchpoints:

- `tools/tui/supervisor.js` (new)
- `src/shared/cli/progress-stream.js` (new)
- `src/shared/progress.js`
- `crates/pairofcleats-tui/src/*` (new)
- `crates/pairofcleats-tui/Cargo.toml` (new)
- `docs/specs/progress-protocol-v2.md`
- `docs/specs/node-supervisor-protocol.md`
- `docs/specs/tui-performance-and-backpressure.md` (new)
- `docs/guides/tui.md`
- `tests/tui/*`

Exit criteria:

- [x] TUI/supervisor protocol, lifecycle, cancellation, install, and observability are strict and fully validated.
- [x] TUI event throughput, frame latency, and backpressure behavior remain stable under sustained high-volume runs.

---

### Phase 10 - Native/WASM acceleration decision phase

Intent: evaluate acceleration and, if adopted, cut over cleanly without dual runtime paths.
#### 10.1 Feasibility and decision

- [x] Define ABI strategy and parity harness.
- [x] Define explicit ABI/runtime boundary contract: ownership model, allocation/free responsibility, panic/error isolation, cancellation semantics.
- [x] Define versioned runtime negotiation handshake (`abiVersion`, runtime kind, feature bits) and deterministic failure modes for mismatches.
- [x] Define deterministic fallback semantics when native runtime is unavailable/invalid so retrieval behavior remains contract-stable.
- [x] Reconcile existing native-accel specs with executable harness and measurable acceptance criteria.
- [x] Decide go/no-go with explicit acceptance criteria.

Touchpoints:

- `src/shared/native-accel.js` (new)
- `src/shared/capabilities.js`
- `tools/setup/rebuild-native.js`
- `tools/build-native.js` (new)
- `src/retrieval/native/*`
- `docs/specs/native-accel.md`
- `docs/perf/native-accel.md`

Tests:

- [x] `tests/retrieval/native/feasibility-parity-harness.test.js` (new)
- [x] `tests/retrieval/native/abi-handshake-version-mismatch.test.js` (new)
- [x] `tests/retrieval/native/fallback-contract.test.js` (new)

#### 10.1b If no-go: closure and cleanup

- [x] Remove or archive experimental native acceleration scaffolding introduced during feasibility work.
- [x] Freeze the no-go decision in active specs/docs and update capability surfaces so runtime selection remains single-path.
- [x] Keep parity harness artifacts for auditability, but mark acceleration implementation tasks as closed-not-adopted.

Touchpoints:

- `src/shared/native-accel.js` (new)
- `src/shared/capabilities.js`
- `tools/build-native.js` (new)
- `docs/specs/native-accel.md`
- `docs/perf/native-accel.md`
- `docs/archived/native-accel-*.md` (new)

Tests:

- [x] No-go capability surface tests (native runtime disabled/absent still matches canonical behavior).
- [x] No-go docs/spec consistency tests.

#### 10.2 If go: hard cutover plan

- [x] Implement bitmap/top-k/ANN/worker acceleration with deterministic contracts. (N/A: no-go decision)
- [x] Enforce ABI boundary wrappers with explicit ownership/lifetime rules and deterministic panic/error mapping. (N/A: no-go decision)
- [x] Enforce canonical native-result serialization ordering before parity comparison/output handoff. (N/A: no-go decision)
- [x] Enforce deterministic cancellation and shutdown resource cleanup in native worker paths. (N/A: no-go decision)
- [x] Remove superseded codepaths in the same cutover. (N/A: no-go decision)
- [x] Update retrieval specs/tests to active behavior only. (N/A: no-go decision)

Tests:

- [x] `tests/retrieval/native/bitmap-equivalence.test.js` (new) (N/A: no-go decision)
- [x] `tests/retrieval/native/topk-equivalence.test.js` (new) (N/A: no-go decision)
- [x] `tests/retrieval/native/topk-adversarial-tie-parity.test.js` (new) (N/A: no-go decision)
- [x] `tests/retrieval/native/ann-equivalence.test.js` (new) (N/A: no-go decision)
- [x] `tests/retrieval/native/ann-preflight-error-taxonomy.test.js` (new) (N/A: no-go decision)
- [x] `tests/retrieval/native/worker-offload-equivalence.test.js` (new) (N/A: no-go decision)
- [x] `tests/retrieval/native/worker-cancel.test.js` (new) (N/A: no-go decision)
- [x] `tests/retrieval/native/panic-isolation.test.js` (new) (N/A: no-go decision)
- [x] `tests/retrieval/native/resource-cleanup-determinism.test.js` (new) (N/A: no-go decision)

Touchpoints:

- `src/shared/native-accel.js` (new)
- `src/shared/capabilities.js`
- `src/retrieval/native/*`
- `tools/build-native.js` (new)
- `docs/specs/native-accel.md`
- `docs/perf/native-accel.md`

Exit criteria:

- [x] Decision made and implemented as a single active path.

---

## Final definition of done

- [ ] Active contracts/specs/tests reflect current behavior only.
- [ ] No compatibility shims or dual-runtime behavior remain.
- [ ] Release, packaging, and platform behavior are deterministic.
- [ ] Core indexing/retrieval/workspace behavior is deterministic and validated.
- [ ] TUI/supervisor stack is production-stable and fully tested.

