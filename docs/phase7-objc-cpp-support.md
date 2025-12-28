# Phase 7: ObjC/C/C++ Support

## Scope
Add C-family chunking and metadata extraction for `.c`, `.cc`, `.cpp`, `.h`, `.hpp`, `.m`, `.mm`.

## Chunking Strategy
- Regex-driven detection of top-level C/C++ types (`struct`, `class`, `enum`, `union`) plus function bodies.
- Objective-C blocks parsed via `@interface`, `@implementation`, `@protocol` with method selector extraction.
- Brace matching is used to determine chunk end; `@end` is used for ObjC blocks.
- Falls back to size-based chunks if no declarations are detected.

## Metadata
- `kind`: `FunctionDeclaration`, `ClassDeclaration`, `StructDeclaration`, `EnumDeclaration`, `UnionDeclaration`, `InterfaceDeclaration`, `ImplementationDeclaration`, `ProtocolDeclaration`, `MethodDeclaration`.
- `docmeta`: signature, params, returns, modifiers, conforms, attributes, docstring.
- `codeRelations`: `#include` entries stored as imports; no call graph yet.

## Notes
- Parsing is heuristic (no clang/treesitter dependency).
- ObjC selectors are recorded as `Type.selector:` when a parent type is detected.
