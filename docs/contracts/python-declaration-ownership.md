# Python declaration ownership

The CPython metadata collector traverses a declaration header in its surrounding
lexical context, then enters the new function or class scope to traverse its
body. Decorators, defaults, annotations, class bases and metaclass expressions
cannot enter an uncalled function's body facts. Header observations remain
syntactic evidence; deferred annotations and generic parameter evaluation do
not establish runtime execution or a complete Python scope model.

File-level call pairs and call details use the nearest interleaved lexical
owner, including a class body inside a function. That caller matches the
qualified name used by the existing chunk and relation projection. A class
body's eager calls and its method headers belong to that class, while each
method body retains its own facts. Functions nested inside methods remain
functions. Top-level declaration headers retain the existing module caller.

Flow accumulation continues to use each declaration's source-qualified scope
identity. Header traversal does not merge body return/control-flow counters or
reads into a neighboring declaration. This changes producer meaning and
requires the shared source-chunking version increment before derived replay.

The authored regression follows the real Python transport, registered language
adapter, call index and chunk relation projection. It is unvalidated. Anonymous
callables, deferred execution, dynamic target resolution and complete runtime
or source-language scope qualification remain separate work.
