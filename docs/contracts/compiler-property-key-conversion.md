# Compiler property key conversion

The compiler CFG uses one computed-name evaluation path for object data properties, object methods/accessors and class members. It evaluates the source key expression once, then represents its `ToPropertyKey` conversion before evaluating a data-property initializer or creating a method. The conversion may invoke user code or throw. Its exceptional route uses the existing enclosing catch/finally destinations, so failure does not execute the property's initializer, later object properties or the method body/default parameters. Existing class heritage/key/static-initialization ordering is retained.

The shared compiler operation dependency owner preserves the source key expression as a modeled input to conversion. Both CFG flow and the immutable value slice consume that owner. Possible coercion effects remain `property_key_coercion_effects_unresolved`; an exact source key does not prove coercion, binding or runtime execution. Implicit exception payloads remain conservative.

Authored regressions inspect the real CFG for data/method/getter/setter conversion order and catch/finally destinations, plus actual retained semantic rows for the reaching `x = 0` at a catch return when conversion fails before any initializer/body write. The immutable value slice is checked against the same source key input. This changes the shared `cfgFlow` and `valueSlice` producer identities. No syntax, compiler binding or LSP producer identity changes are intended.

All checks are **UNVALIDATED** under the development-first instruction. No tests, syntax, format, bootstrap, native execution, source function execution or runtime qualification was performed.
