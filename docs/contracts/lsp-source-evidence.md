# LSP source evidence and compiler execution boundaries

LSP lines split on LF, CRLF and lone CR. U+2028/U+2029 remain characters within
the protocol line, even when a compiler's source-line model differs. Requests
encode UTF-16 source offsets into the negotiated UTF-8, UTF-16 or UTF-32 unit.
Incoming ranges must roundtrip exactly; clamped and reversed ranges contribute
no source ownership. Chunks use half-open ranges. A zero-width insertion belongs
to the nonempty containing chunk on its right; document EOF belongs to none.

Inlay labels are observations until a bounded declaration-header scan attributes
the insertion to a parameter binding or the return position. Local variables,
nested declarations and argument-name hints cannot supply an enclosing callable's
return or parameter types. Qualified type hints retain `lsp_inlay` provenance and
cannot by themselves mark a callable's return evidence complete or suppress a
richer signature request. The hover request cache identity is `rq3`.

An object method's computed key evaluates when the object is created and may
throw. Its parameter defaults and body evaluate only on invocation. A bare `var`
redeclaration performs no runtime assignment and cannot overwrite a parameter
or an earlier initializer. Contiguous labels on an iteration share its continue
target; finalizer routing still owns abrupt completion. These compiler and LSP
meaning changes require their shared analysis-version increments before replay
reuse. Regression sources are development assertions; this document does not
claim native/provider qualification.

Immutable join work is session/group owned. LSP sessions index normalized paths,
full parent/segment/range identities and declaration intervals once, and compute
one source-inventory digest. A declaration lookup distinguishes unique from
multiple containment; it never resolves ambiguity by choosing the nearest span.
Provider alias joins memoize validated directional closures with explicit depth,
queue, target, traversal-work and retained-byte bounds. Replaying a cached partial
closure preserves its truncation and does not establish complete dispatch.

Dispatch caches retain immutable member/accessor/class structure with reason
metadata, while each call keeps its own mutable assignment, recursion and target
budget. Finalizer CFG nodes may be shared only with equal pending completion
contexts and exact destinations. Construction uses bounded work and an estimated
byte admission tied to the existing queued-byte policy; an exhausted owner graph
is discarded and local-flow coverage remains partial. No incomplete graph is
solved as if its completion routes were complete.

Worker message joins index exact worker sources and canonical opposite channel
endpoints. Received endpoint roots subscribe dependent consumers/sends; only
changed roots and newly available peers trigger another bounded propagation wave.
Overflow uses an explicit bounded conservative fallback. All emitted worker edges
remain source candidates, with runtime delivery/instance/detachment uncertainty.
These changes describe operation structure, not measured end-to-end speedups.
