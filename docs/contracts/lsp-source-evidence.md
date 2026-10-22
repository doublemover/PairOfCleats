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
