# Parser Backbone and Analysis Pipeline

This document describes the planned unified parsing backbone, native parser usage, and the shared analysis pipeline for control-flow, dataflow, and type inference.

## Goals
- Prefer stable native parsers when they are available and reliable.
- Use a unified parsing backbone (tree-sitter) for all other languages and formats to reduce repeated work.
- Keep tooling optional, auto-enable it when detected, and default to cache-local installs.

## Parser strategy

### Native parsers (preferred when stable)
- JavaScript/TypeScript: native parser when available (Acorn/TypeScript compiler API).
- Python: stdlib ast via a local interpreter.
- Other languages: native parsers only when stable and easy to integrate.

### Unified backbone
- tree-sitter provides a consistent AST interface for new languages and formats.
- Native parsers still run first when available to enrich or replace tree-sitter output.

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
- Cross-file inference remains planned behind `indexing.typeInferenceCrossFile`.

## Tooling detection and install policy
- Auto-enable tooling when detected.
- Default install scope: cache-local.
- Optional install scope: user or system when requested.
- When auto-install is not possible, print the canonical install guide URL.

Planned config keys:
- tooling.autoInstallOnDetect (default false)
- tooling.installScope (cache | user | system)
- tooling.allowGlobalFallback (default true)
- indexing.cfg (default false)
- indexing.astDataflow (default true)
- indexing.typeInference (default false)
- indexing.typeInferenceCrossFile (default false)

## SQL dialects
- PostgreSQL, MySQL, and SQLite grammars with dialect selection rules.
- Dialect selection by extension and optional config override.
