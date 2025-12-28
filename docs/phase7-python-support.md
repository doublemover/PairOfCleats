# Phase 7: Python Support

## Scope
Use Python AST for chunking and metadata extraction when Python is available; fall back to heuristic indentation when it is not.

## Chunking Strategy
- Prefer the Python stdlib `ast` module when `python`/`python3` is available.
- Chunk by `ClassDef`, `FunctionDef`, and `AsyncFunctionDef`.
- Methods are qualified as `ClassName.method`.
- Fallback: line-based indentation heuristic.

## Metadata
- `kind`: `ClassDeclaration`, `FunctionDeclaration`, `MethodDeclaration`.
- `name`: qualified names for methods.
- `docmeta`: docstring, decorators, signature, params, returns.
- `codeRelations`: imports, exports (top-level defs), calls (caller->callee), usages, importLinks.

## Requirements
- Optional Python 3 on PATH for AST enrichment.
- Without Python, chunking still works but richer metadata is unavailable.

## Next Steps
- Improve call graph accuracy for nested functions.
- Add type-aware docs for dataclasses and attrs models.
