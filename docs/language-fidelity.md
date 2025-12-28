# Language Fidelity Checklist

Use this checklist to validate chunking and metadata for each language. The goal is to keep behavior stable as parsing rules evolve.

## Common checks (all languages)
- Chunk boundaries align with declaration bodies.
- start/end offsets and startLine/endLine are correct.
- name and kind are populated for each declaration.
- doc comments are captured when present.
- signatures and params are extracted where supported.
- imports/exports/usages/calls are populated when supported.
- control-flow metadata is present when enabled (branches/loops/returns/breaks/continues/throws/awaits/yields).
- type inference metadata is present when enabled (params/returns/fields/locals with sources).

## Python
- Functions, classes, and methods are chunked via AST when python is available.
- Nested functions are qualified (outer.inner) to avoid collisions.
- Decorators, docstrings, params, and returns are captured.
- Dataclass/attrs field definitions are surfaced in metadata.
- Imports and calls are captured from AST.
- Dataflow metadata includes reads/writes/mutations/throws/awaits/yields when enabled.
- Control-flow metadata includes branch/loop/return counts when enabled.
- Base classes, visibility, and param type/default metadata are present when available.

## JavaScript
- Functions, classes, and methods are chunked via AST.
- Signatures and params are captured from AST (including defaults).
- Modifiers include async/generator/static and visibility where detectable.
- Class inheritance (`extends`) is captured for class declarations.
- Dataflow metadata includes reads/writes/mutations/throws/awaits/yields when enabled.
- Control-flow metadata includes branch/loop/return counts when enabled.

## Swift
- class/struct/enum/protocol/extension/actor declarations are chunked.
- Methods are qualified as Type.method when nested in a type.
- Signatures and modifiers are captured.
- Generics and where clauses are captured in metadata.
- Extensions do not break chunking.

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
- macro_rules!/macro declarations are chunked when possible.

## Go
- struct/interface/type/func declarations are chunked.
- Methods are qualified as Type.method when receivers are present.
- Doc comments are captured for declarations.
- Imports are captured from import blocks and single imports.
- Calls/usages are captured for function bodies when possible.

## Java
- class/interface/enum/record declarations are chunked.
- Methods/constructors are qualified as Type.method.
- Javadoc and annotations are captured in metadata.
- Imports are captured from import statements.
- Calls/usages are captured for method bodies when possible.

## TypeScript
- class/interface/enum/type declarations are chunked.
- Methods/constructors are qualified as Type.method.
- Doc comments and decorators are captured in metadata.
- Imports/exports are captured from ES module syntax.
- Calls/usages are captured for function bodies when possible.

## C#
- namespace/type declarations are chunked.
- Methods/constructors are qualified as Type.method.
- XML doc comments and attributes are captured in metadata.
- using imports are captured from using statements.
- Calls/usages are captured for method bodies when possible.

## Kotlin
- class/interface/object declarations are chunked.
- Methods are qualified as Type.method.
- KDoc and annotations are captured in metadata.
- Imports are captured from import statements.
- Calls/usages are captured for function bodies when possible.

## Ruby
- module/class declarations are chunked.
- Methods are qualified as Type.method when nested.
- Doc comments are captured from preceding # lines.
- require/require_relative statements are captured as imports.
- Calls/usages are captured for method bodies when possible.

## PHP
- class/interface/trait declarations are chunked.
- Methods are qualified as Type.method.
- Doc comments and attributes are captured in metadata.
- use statements are captured as imports.
- Calls/usages are captured for method bodies when possible.

## Lua
- function/method declarations are chunked.
- Doc comments are captured from preceding -- lines.
- require statements are captured as imports.
- Calls/usages are captured for function bodies when possible.

## SQL
- CREATE statements are chunked (table/view/function/index/etc).
- Statement doc comments are captured from preceding -- or /* */ blocks.
- Dialect metadata is captured via extension mapping or config overrides.
- Exports include declared objects when possible.

## Perl (lite)
- package declarations and subs are chunked.
- Doc comments from preceding # lines are captured.
- use/require statements are captured as imports.
- Calls/usages are captured for sub bodies when possible.

## Shell (lite)
- function declarations are chunked.
- Doc comments from preceding # lines are captured.
- source/. statements are captured as imports.
- Calls/usages are captured for function bodies when possible.

## Config + docs formats
- JSON/TOML/INI/XML chunking uses top-level keys or section headers.
- Dockerfile chunking uses instruction boundaries.
- Makefile chunking uses target boundaries.
- GitHub Actions YAML chunking uses job entries under jobs.
- RST/AsciiDoc chunking uses heading boundaries.
