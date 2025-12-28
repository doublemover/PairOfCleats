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

## Configurability
- `indexing.astDataflow` (default: true) controls whether dataflow metadata is collected.

## Per-language coverage

### JavaScript (Acorn AST)
- Declarations: function/class/method chunks.
- Signatures: params + defaults from AST (approximate), arrow vs function signatures.
- Modifiers: async, generator, static, visibility (private identifiers and leading underscore).
- Inheritance: `extends` for class declarations.
- Dataflow: reads/writes/mutations/throws/returns/awaits/yields per function.

### Python (stdlib ast)
- Declarations: function/method/class chunks via AST.
- Signatures: full args (positional, keyword-only, varargs), defaults, return type annotations.
- Modifiers: async, generator, visibility (underscore conventions).
- Decorations: decorators captured.
- Inheritance: base classes captured.
- Dataflow: reads/writes/mutations/throws/returns/awaits/yields, plus globals/nonlocals.
