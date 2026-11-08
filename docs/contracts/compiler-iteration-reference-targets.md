# Compiler iteration reference targets

For `for ... of` and `for ... in` assignments to a property, the existing CFG evaluates the target receiver and computed key for each produced element/key before assigning and entering the body. The iterable/enumerated expression stays at loop entry. An empty iteration does not evaluate its target, and `continue` returns to the next iteration test before a later target evaluation.

The target uses the same reference evaluation as simple assignment: wrapped locations retain their identity, receiver properties can read values, and the selected property is written without reading its old value. Target exceptions use the existing catch/finally route. The existing unknown yielded element/key stays distinct from the iterable itself.

These evaluations supply actual reaching definitions and CFG call-execution owners to the existing retained flow and call-summary consumers. The shared CFG producer identity must advance. This repair does not establish iterator protocol effects, destructuring defaults, asynchronous iteration, iterator closing, exact key/value production or complete per-iteration lexical binding semantics; existing conservative coverage remains.

Authored actual CFG and retained regressions inspect receiver/key/body order, zero-iteration and continue paths, target failures, assignment values observed in the body and the canonical call-execution owner. All are **UNVALIDATED**; no tests, syntax, format, bootstrap, compiler/native/source execution, full index or benchmark was run.
