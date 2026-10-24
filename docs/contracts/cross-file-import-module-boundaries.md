# Cross-file known import module boundaries

A declared import binding owns its root name even when this heuristic resolver
cannot establish the module target. Missing relative files, external packages,
configured aliases and other unsupported module forms do not authorize a fallback
to repository-global same-name or same-leaf declarations. Their admitted local
candidate set is empty, the reference remains unresolved, and its existing
import hint retains the supplied module specifier and unavailable resolved file.

Supported relative imports still narrow through the existing admitted file
inventory and mapped member-target checks. Names without a declared import
retain their existing unique-name/leaf heuristic. Existing compiler-owned call
detail bindings remain a separate stronger route; this change does not claim a
package resolver, alias resolver, filesystem acquisition or compiler fallback.

The shared call-flow producer version binds the changed cross-file candidate
admission. File lookup algorithms, limits, defaults and cache stores do not
change. Authored controls cover real parser-owned import/call and direct-return
facts through call indexing, chunk handoff, source-pinned cold propagation and
qualified warm replay. Missing relative, external, namespace and configured-alias
imports cannot borrow unrelated local return types; supported relative and
unimported controls retain theirs. All remain **unvalidated**.

Export/alias completeness inside a resolved module, native/embedded coordinate
parity, package/type dispatch, declaration shadowing, concurrent input mutation,
and runtime/performance qualification remain separate work.
