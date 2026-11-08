# Compiler iteration accessor roles

The existing compiler implicit-accessor collector treats a simple property
initializer of `for…of`, `for…in` and async `for…of` as an assignment reference.
Transparent expression wrappers preserve that role. It retains the setter
candidate and suppresses a getter for the selected property. A receiver such as
`box.child` in `box.child.value` still retains its own getter candidate.

The yielded element or enumerated key does not have an admitted value expression
in the current iterator model. The existing nullable argument slot remains
unknown; neither the iterable object nor the loop syntax is projected as an
`argumentToParameter` value. Iterable evaluation remains an unknown effect input
under an explicit `iteration_assignment_value_unresolved` reason. Setter targets
stay incomplete candidates, and setter return values are suppressed.

This uses the existing CFG execution owner, summary builder and retained
cross-file call channels. The shared call-flow producer version must advance;
local CFG, compiler binding and schema identities do not change. It does not
establish iterator protocol/close, async delivery, per-iteration execution,
descriptor mutation, destructuring assignment, unique dispatch or source-language
closure. Those frontiers remain separate from the selected reference role.

Authored actual compiler/CFG ownership and retained-partition controls cover
dot/literal-key targets, wrappers, receiver getters, ordinary body reads, actual
assignment RHS values, setter targets and absent fabricated argument/return
channels. They are **UNVALIDATED**; no tests, syntax, lint, format, bootstrap,
compiler/native/source execution or benchmarks were run.
