# Phase 7: Swift Support

## Scope
Add Swift-aware chunking and metadata extraction for `.swift` files without external tooling.

## Chunking Strategy
- Brace-aware scanning for `class`, `struct`, `enum`, `protocol`, `extension`, `actor`, `func`, `init`, `deinit`.
- Methods are qualified as `Type.method` when nested under a type declaration.
- Falls back to size-based chunks if no declarations are detected.

## Metadata
- `kind`: `ClassDeclaration`, `StructDeclaration`, `EnumDeclaration`, `ProtocolDeclaration`, `ExtensionDeclaration`, `ActorDeclaration`, `FunctionDeclaration`, `MethodDeclaration`, `Initializer`, `Deinitializer`.
- `docmeta`: signature, params, returns, attributes, modifiers, conforms.
- Doc comments collected from `///` or `/** */` blocks above the declaration.

## Requirements
- No external dependencies; parsing is handled in Node.
