# Transparent compiler alias consumers

The existing compiler property-path owner defines one transparent-expression policy for parentheses, `as`, type assertions, non-null assertions and `satisfies`. These wrappers preserve the evaluated runtime value/reference; type syntax does not supply another allocation, assignment location or invocation input.

The shared alias-assignment inventory resolves a wrapped left side to its actual lexical/property binding before indexing the right side. Existing dispatch, field-root, class-definition and call/apply/bind consumers use the same policy. Wrapped property/prototype patch receivers retain their source candidates. `satisfies`-wrapped allocations and class aliases remain available to field and constructor queries, and an erased wrapper around an apply argument array or bound function cannot hide its actual argument slots.

The CFG reference-role, implicit-accessor and runtime-operation dependency owners reuse this policy while preserving their existing evaluation roles. This does not authorize arbitrary expression simplification: calls, comma expressions, conditional branches, optional-chain boundaries and conversions remain their existing owners.

Mutable assignments still form bounded may alternatives under existing assignment-order, escape, descriptor and prototype reasons. This repair does not prove the final runtime target, unique allocation, path feasibility, exact property mutation or closed source-language behavior. Existing candidate/work limits remain explicit. The shared compiler-binding and CFG producer identities must advance because actual binding targets and field-flow candidates change; existing cross-file consumers retain those new input identities.

Authored regressions exercise the actual checker, shared assignment inventory, dispatch/class/field/call-adapter owners, retained cross-file target/return/argument channels and the production compiler-binding fixture. All are **UNVALIDATED**; no tests, syntax, format, bootstrap, compiler/native/source execution, full index or benchmark was run.
