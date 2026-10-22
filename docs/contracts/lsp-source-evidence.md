# LSP source evidence and compiler execution boundaries

LSP lines split on LF, CRLF and lone CR. U+2028/U+2029 remain characters within
the protocol line, even when a compiler's source-line model differs. Requests
encode UTF-16 source offsets into the negotiated UTF-8, UTF-16 or UTF-32 unit.
Incoming ranges must roundtrip exactly; clamped and reversed ranges contribute
no source ownership. Chunks use half-open ranges. A zero-width insertion belongs
to the nonempty containing chunk on its right; document EOF belongs to none.
The shared exact-coordinate helper also rejects an endpoint between a UTF-16
surrogate pair. Canonical evidence, legacy symbol enrichment and diagnostic
projection use that same check; an invalid diagnostic consumes no chunk quota.

Location and LocationLink retain their distinct required fields. A link cannot
substitute its whole target range for an absent target selection. Canonical
definition joins require both the selection and its enclosing range to map
exactly to the captured source, with selection containment. Malformed protocol
shapes remain raw evidence and cannot mint declaration candidates. An otherwise
well-shaped location with an unmappable enclosing range remains a heuristic
external candidate with no source range.

Structured DocumentSymbol and call/type hierarchy observations enforce the same
selection containment and exact container mapping before qualifying a target.
Invalid hierarchy selections do not mint follow-up item tokens. Flat
SymbolInformation retains its single location range without an invented
container. A malformed origin range keeps an observation partial even when its
separate target is source-qualified. These are protocol/source ownership checks,
not proof of runtime dispatch or project analysis completeness.

Inlay labels are observations until a bounded declaration-header scan attributes
the insertion to a parameter binding or the return position. Local variables,
nested declarations and argument-name hints cannot supply an enclosing callable's
return or parameter types. Qualified type hints retain `lsp_inlay` provenance and
cannot by themselves mark a callable's return evidence complete or suppress a
richer signature request. The hover request cache identity is `rq10`.

Header ownership balances parentheses, arrays and object delimiters, so commas
inside default expressions cannot invent parameter boundaries. Only a simple
identifier/rest binding head can own a parameter slot; matching a supplied name
inside a destructuring pattern or default initializer is insufficient. Quoted
strings and comments retain their existing bounded scan. Generic angle syntax,
regex/division ambiguity, malformed delimiters, invalid name anchors and an
unfinished 16 KiB header remain unqualified observations. Unsupported headers do
not acquire return ownership from an earlier nested close parenthesis. Type hints
at identifier starts or at the closing parenthesis are not insertion slots;
positive fixtures use the name end or the position after the closing parenthesis.
These source-role changes require the shared LSP producer version increment.
Inlay acquisition remains request-local; this change does not add hint-derived
values to the persisted hover request cache.

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
