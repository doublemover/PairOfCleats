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
- Aliases: assignment-based alias pairs (e.g., `alias=source`).
- Throws/Raises: exception types raised or thrown.
- Returns: whether a declaration returns a value.
- Awaits/Yields: awaited or yielded calls.
- Globals/Nonlocals: Python-specific scope declarations.

## Risk metadata
- Stored under `docmeta.risk`.
- Sources: taint-style inputs (e.g., HTTP params, env vars, stdin).
- Sinks: risky APIs (command exec, SQL execution, XSS, deserialization).
- Flows: source→sink pairs with category/severity; `scope` is `local` or `cross-file` and `via` captures the call link when cross-file.
- Tags/Categories: normalized labels for filtering and search.

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
- Cross-file inference can add `flow` entries based on return-call propagation.

## Interprocedural metadata
- Call links in `codeRelations.callLinks` include resolved symbol targets with optional return/param type hints.
- Call summaries in `codeRelations.callSummaries` include call args, target signatures, and positional arg maps when available.

## Configurability
- `indexing.astDataflow` (default: true) controls whether dataflow metadata is collected.
- `indexing.controlFlow` (default: true) controls whether control-flow metadata is collected.
- `indexing.riskAnalysis` (default: true) controls whether risk metadata is collected.
- `indexing.riskAnalysisCrossFile` (default: true) controls cross-file risk correlation.
- `indexing.typeInference` (default: false) controls whether inferred types are collected.
- `indexing.typeInferenceCrossFile` (default: false) controls cross-file inference and linking.

## Per-language coverage

### JavaScript (Acorn AST)
- Declarations: function/class/method chunks.
- Signatures: params + defaults from AST (approximate), arrow vs function signatures.
- Modifiers: async, generator, static, visibility (private identifiers and leading underscore).
- Inheritance: `extends` for class declarations.
- Dataflow: reads/writes/mutations/aliases/throws/returns/awaits/yields per function.
- Control-flow: keyword counts (branches/loops/returns/breaks/continues/throws/awaits/yields).
- Type inference: annotations + defaults + literal assignments (when enabled).

### Python (stdlib ast)
- Declarations: function/method/class chunks via AST.
- Signatures: full args (positional, keyword-only, varargs), defaults, return type annotations.
- Modifiers: async, generator, visibility (underscore conventions).
- Decorations: decorators captured.
- Inheritance: base classes captured.
- Dataflow: reads/writes/mutations/aliases/throws/returns/awaits/yields, plus globals/nonlocals.
- Control-flow: keyword counts (branches/loops/returns/breaks/continues/throws/awaits/yields).
- Type inference: annotations + defaults + literal assignments (when enabled).

## Heuristic languages
- C/C++/ObjC, Rust, Go, Java, Swift, C#, Kotlin, Ruby, PHP, Lua, Perl, Shell include control-flow counts when enabled.
