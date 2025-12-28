# Phase 7: Rust Support

## Scope
Add Rust-aware chunking and metadata extraction for `.rs` files without external tooling.

## Chunking Strategy
- Heuristic parsing for `struct`, `enum`, `trait`, `mod`, `impl`, and `fn`.
- Functions inside `impl`/`trait` blocks are emitted as `Type.method` chunks.
- Brace matching is used to determine chunk boundaries.
- Falls back to size-based chunks when no declarations are detected.

## Metadata
- `kind`: `StructDeclaration`, `EnumDeclaration`, `TraitDeclaration`, `ModuleDeclaration`, `ImplDeclaration`, `FunctionDeclaration`, `MethodDeclaration`.
- `docmeta`: signature, params, returns, modifiers, attributes, docstring.
- `codeRelations`: `use`/`extern crate` entries stored as imports; exports via `pub` items.

## Notes
- Parsing is heuristic (no Rust AST dependency).
- Raw strings and macro-heavy files may reduce chunk accuracy.
