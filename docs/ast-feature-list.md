# AST Feature List

This document defines the "complete" AST metadata feature set and how each AST-backed language maps to it.

## Core symbol metadata
- Declarations: functions, methods, classes, and nested symbols.
- Signatures: parameter lists with defaults, plus return type when available.
- Modifiers: async/generator/static, visibility (public/protected/private), and method kind.
- Decorations: decorators/annotations when supported.
- Inheritance: base classes / extends / implements (when available).

## Dataflow metadata
- Reads: identifiers read within a declaration body.
- Writes: identifiers assigned within a declaration body.
- Mutations: attribute/index updates (object.field or object[key]).
- Throws/Raises: exception types raised or thrown.
- Returns: whether a declaration returns a value.
- Awaits/Yields: awaited or yielded calls.
- Globals/Nonlocals: Python-specific scope declarations.

## Control-flow metadata
- Branches: if/else/switch/case/try/catch counts.
- Loops: for/while/do/repeat counts.
- Returns: return statement count.
- Breaks/Continues: loop flow-control counts.
- Throws/Awaits/Yields: keyword counts for flow operations.

## Type inference metadata
- Inferred types are stored in `docmeta.inferredTypes`.
- Shape: `{ params, returns, fields, locals }`, where values are arrays of `{ type, source, confidence }`.
- Sources include annotation, default, literal, flow, and tooling.

## Configurability
- `indexing.astDataflow` (default: true) controls whether dataflow metadata is collected.
- `indexing.controlFlow` (default: true) controls whether control-flow metadata is collected.
- `indexing.typeInference` (default: false) controls whether inferred types are collected.

## Per-language coverage

### JavaScript (Acorn AST)
- Declarations: function/class/method chunks.
- Signatures: params + defaults from AST (approximate), arrow vs function signatures.
- Modifiers: async, generator, static, visibility (private identifiers and leading underscore).
- Inheritance: `extends` for class declarations.
- Dataflow: reads/writes/mutations/throws/returns/awaits/yields per function.
- Control-flow: keyword counts (branches/loops/returns/breaks/continues/throws/awaits/yields).
- Type inference: annotations + defaults + literal assignments (when enabled).

### Python (stdlib ast)
- Declarations: function/method/class chunks via AST.
- Signatures: full args (positional, keyword-only, varargs), defaults, return type annotations.
- Modifiers: async, generator, visibility (underscore conventions).
- Decorations: decorators captured.
- Inheritance: base classes captured.
- Dataflow: reads/writes/mutations/throws/returns/awaits/yields, plus globals/nonlocals.
- Control-flow: keyword counts (branches/loops/returns/breaks/continues/throws/awaits/yields).
- Type inference: annotations + defaults + literal assignments (when enabled).

## Heuristic languages
- C/C++/ObjC, Rust, Go, Java, Swift, C#, Kotlin, Ruby, PHP, Lua, Perl, Shell include control-flow counts when enabled.
