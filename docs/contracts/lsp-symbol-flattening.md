# LSP symbol-tree projection

The existing legacy DocumentSymbol flattener walks explicit parent/index frames
instead of recursing and spreading child result arrays. It preserves preorder,
qualified names, kind/detail, mandatory selection status and original range
objects. A deeply nested finite response no longer depends on JavaScript call
stack depth or the spread-argument limit.

The traversal retains only active child arrays for cycle detection. Reusing an
array in a separate sibling occurrence retains both qualified paths; a cyclic
callback graph is rejected as non-protocol data. The existing response and source
admission owners still govern enrichment; no new semantic cap, parallel store
or completeness claim is introduced.

Authored deep traversal, exact preorder and actual document enrichment
regressions remain unrun. Native, real-server, full indexing and measured
resource/performance qualification remain pending.
