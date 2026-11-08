# Compiler pattern reference roles

The shared compiler runtime context distinguishes lexical reads from identifiers
used as assignment references inside array, object, shorthand and rest patterns.
It follows only transparent wrappers and structural target roles until an
enclosing `=` or `for in` / `for of` initializer proves the reference position.
Ordinary value aggregates retain their lexical reads. Receiver expressions,
computed keys, default right-hand sides and source expressions remain reads.
Deleting a value aggregate still evaluates its elements and properties; it does
not turn their contained lexical values into assignment references.

The decision is cached by actual AST node identity within one runtime context.
Structural ancestors are cached too, so multiple identifiers in a deeply nested
pattern do not repeatedly traverse the same enclosing chain. No syntax source
fallback, compiler-node copy, native handle or new cache store is introduced.

This classifier is consumed by the CFG, immutable value slice, platform callback
payload projection and Node worker payload-use inventory. Those producer versions
must advance together; compiler binding and call-target candidate meanings are
unchanged. An assignment target must not acquire a read/capture or delivered
payload-use edge merely because the enclosing pattern contains that identifier.

The authored controls use the actual compiler/checker, retained CFG/value-slice
writers and platform/Node callback consumers. They are **UNVALIDATED**. This is a
reference-role repair only. Extracted destructuring values, conditional defaults,
iterator closing, alias-safe updates, callback activation and mutable payload
reaching definitions remain partial. No native, provider, runtime, performance or
full source-language closure is established.
