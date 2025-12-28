# Language Fidelity Checklist

Use this checklist to validate chunking and metadata for each language. The goal is to keep behavior stable as parsing rules evolve.

## Common checks (all languages)
- Chunk boundaries align with declaration bodies.
- start/end offsets and startLine/endLine are correct.
- name and kind are populated for each declaration.
- doc comments are captured when present.
- signatures and params are extracted where supported.
- imports/exports/usages/calls are populated when supported.

## Python
- Functions, classes, and methods are chunked via AST when python is available.
- Nested functions are qualified (outer.inner) to avoid collisions.
- Decorators, docstrings, params, and returns are captured.
- Dataclass/attrs field definitions are surfaced in metadata.
- Imports and calls are captured from AST.

## Swift
- class/struct/enum/protocol/extension/actor declarations are chunked.
- Methods are qualified as Type.method when nested in a type.
- Signatures and modifiers are captured.
- Generics and extensions do not break chunking.

## ObjC/C/C++
- C-family functions and types are chunked with brace matching.
- ObjC interface/implementation blocks are chunked by @end.
- ObjC method selectors include the parent type when known.
- Includes are captured as imports; basic calls/usages are present when possible.

## Rust
- struct/enum/trait/mod/impl/fn declarations are chunked.
- Methods inside impl/trait blocks are qualified as Type.method.
- Attributes and doc comments are captured.
- use/extern crate statements are captured as imports.
