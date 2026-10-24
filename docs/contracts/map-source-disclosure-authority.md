# Remote source disclosure authority

Remote member, detail and relationship panels capture their original source,
source index and receiver-bound requester. Query dispatch and fulfilled results
require that exact source/index plus the original attached panel. Closing and
reopening a disclosure never adopts a newer source's requester. A successful late
page cannot publish into a still-attached panel after source replacement.

Issued buttons retain original navigation/open/reveal callbacks and require both
their original disclosure and their own attached node. Detached or replaced
source actions cannot navigate or start another request. Error admission checks
the same original authority before inspecting diagnostics, then uses the shared
scene failure snapshot and checks authority again before publication. Falsey
failures and throwing diagnostic getters cannot replace the original operation
failure with a direct `error.message`/`error.name` access.

The actual disclosure and request-owner controls are authored but unrun. They
qualify neither browser MutationObserver delivery nor complete panel/native
observer shutdown. The existing original transport/body owners remain responsible
for their own cleanup and pending-resource observations; this admission fence is
not proof of native quiescence, GPU recovery or measured UI performance.
