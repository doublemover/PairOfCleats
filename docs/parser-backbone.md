# Parser Backbone and Analysis Pipeline

This document describes the planned unified parsing backbone, native parser usage, and the shared analysis pipeline for control-flow, dataflow, and type inference.

## Goals
- Prefer stable native parsers when they are available and reliable.
- Use a unified parsing backbone (tree-sitter) for all other languages and formats to reduce repeated work.
- Keep tooling optional, auto-enable it when detected, and default to cache-local installs.

## Parser strategy

### Native parsers (preferred when stable)
- JavaScript/Flow: Babel parser by default, with Acorn/Esprima fallbacks for comparison.
- TypeScript: TypeScript compiler API when available; Babel parser fallback when not.
- Python: stdlib ast via a local interpreter.
- Other languages: native parsers only when stable and easy to integrate.

### Unified backbone
- tree-sitter provides a consistent AST interface for new languages and formats.
- Native parsers still run first when available to enrich or replace tree-sitter output.
- Default choice: native tree-sitter bindings (fast parse, no WASM startup, better memory reuse).
- Optional fallback: web-tree-sitter (WASM) when native bindings are unavailable, slower to load but easier to ship in strict environments.

### ESTree interop
- `@typescript-eslint/typescript-estree` was considered for strict ESTree output.
- Current decision: not required because TypeScript compiler + Babel parser cover the needed syntax and metadata.
- Revisit if ESTree-specific tooling or stricter AST interop becomes necessary.

## Planned metadata schema

### Core symbol metadata
- Declarations: functions, methods, classes, modules, and nested symbols.
- Signatures: parameter lists with defaults and return types when available.
- Modifiers: async/generator/static/visibility/method kind.
- Decorations: decorators/annotations when available.
- Inheritance: base classes, extends, implements.

### Control-flow and dataflow
- CFG summary: branch counts, loop counts, and early-return markers.
- Dataflow: reads, writes, mutations, throws, returns, awaits, yields.
- Optional scope info (globals/nonlocals) where supported.

### Type inference
- Inferred types for locals, params, returns, and fields.
- Source tags for each inferred type (annotation, literal, flow, tooling).
- Confidence score for inferred types.
- Intra-file inference is available when `indexing.typeInference` is enabled (annotations/defaults/literals).
- Cross-file inference is available when `indexing.typeInferenceCrossFile` is enabled (call/usage linking, return propagation, optional tooling).

## Tooling detection and install policy
- Auto-enable tooling when detected.
- Default install scope: cache-local.
- Optional install scope: user or system when requested.
- When auto-install is not possible, print the canonical install guide URL.

Planned config keys:
- tooling.autoInstallOnDetect (default false)
- tooling.autoEnableOnDetect (default true)
- tooling.installScope (cache | user | system)
- tooling.allowGlobalFallback (default true)
- tooling.enabledTools (allowlist of tool ids)
- tooling.disabledTools (denylist of tool ids)
- tooling.typescript.enabled (default true)
- tooling.typescript.resolveOrder (default: repo, cache, global)
- tooling.typescript.useTsconfig (default true)
- tooling.typescript.tsconfigPath (optional)
- tooling.clangd.requireCompilationDatabase (default false; best-effort without compile_commands.json)
- tooling.clangd.compileCommandsDir (optional)
- indexing.cfg (default false)
- indexing.astDataflow (default true)
- indexing.typeInference (default false)
- indexing.typeInferenceCrossFile (default false)
- indexing.gitBlame (default true)
- indexing.pythonAst.enabled (default true)
- indexing.pythonAst.workerCount / maxWorkers / scaleUpQueueMs / taskTimeoutMs
- search.sqliteAutoChunkThreshold (default 5000)

## SQL dialects
- PostgreSQL, MySQL, and SQLite grammars with dialect selection rules.
- Dialect selection by extension and optional config override.
