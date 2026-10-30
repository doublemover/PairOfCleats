# Computed-name capture ownership

The immutable compiler value slice distinguishes a method/accessor's computed name from its invocation. A constant read in that name belongs to the surrounding object/class creation context. A surrounding function's own local used only as a key cannot become a capture by the method. A module constant read there may instead be captured by the surrounding function.

The existing memoized owner lookup skips a method boundary only when crossing its actual computed-name field. It does not cache that method as owned by its parent. Parameter defaults and bodies retain their invoked method owner; a function nested inside a key expression retains its own closure owner. Actual source reads and the existing computed-key value dependency remain present.

This changes the `valueSlice` producer's persisted capture edges. Syntax, bindings, CFG and call-flow producer meanings are unchanged. The immutable slice remains partial for mutable values, runtime coercion and effects. Creation-context ownership does not prove the key's runtime value or invocation.

The authored regression uses actual compiler syntax/checker identities, writes and validates ordinary semantic partitions, and inspects retained reads/captures for object methods, accessors, class methods, defaults, bodies and nested functions. It is **UNVALIDATED**: no test, syntax, format, bootstrap, compiler/native execution or source execution was performed.
