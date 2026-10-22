# LSP erased callee ownership

The retained LSP session traces a symbol occurrence to its invocation through canonical value-expression operands of parentheses, non-null assertions, `as`, type assertions and `satisfies`. Only the wrapper's `expression` slot can supply that value; its type operand cannot. The same member-name rule continues to exclude a receiver such as `service` in `(service as Service).run()`.

Provider `callTarget`/`constructTarget` evidence belongs to the original invocation anchor. The existing provider call-summary join therefore retains argument and return channels for wrapped callees instead of leaving a declaration-reference edge disconnected from the call. This changes the retained LSP-binding producer identity, without changing request-cache payload parsing or policy.

Arguments, stored values, comma/conditional expressions and unrelated type syntax do not become invocation owners under this policy. Existing bounded operand traversal, source/location admission, ambiguity, optional-call kind and incomplete provider-target remainder are preserved. This is a syntax ownership repair; it does not establish runtime dispatch, optional-call feasibility, argument evaluation or complete language/server support.

Authored regressions use actual retained TypeScript syntax, LSP target discovery/definition admission and provider call-summary consumers with controlled data. They inspect invocation-bound target, argument and return edges, plus type/argument/receiver/storage/comma negatives. All are **UNVALIDATED**; no tests, syntax, format, bootstrap, compiler/server/native/source execution or benchmark was run.
