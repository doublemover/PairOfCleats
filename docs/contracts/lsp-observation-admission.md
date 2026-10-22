# Structured LSP observation admission

The existing session-local collector copies and freezes canonical request
parameters before transport admission. Concurrent reuse and the retained result
use that same identity. Caller edits during an awaited request cannot change
the URI, position or scope represented by its response. Origin fallback uses the
captured session identity. The collector checks cancellation and current source,
session and profile identity again after source projection and before commit.

Hierarchy continuation tokens bind both the captured session identity and the
call or type hierarchy family. A call hierarchy item's opaque provider data
cannot authorize a type hierarchy request, or the reverse. Tokens remain local
to their original collector and do not authorize later sessions or live requests
from retained evidence artifacts.

New hierarchy tokens are staged during projection and enter the inventory only
after the full observation fits the existing shared output byte allowance.
Opaque item data borrows the admitted immutable raw response subtree; it does
not create a separately copied, uncharged store. Rejected output and source
identity changes retain no staged items. Existing fact, item and observation
counts remain bounded by the collector's allowances.

Each projected primary fact and each related hierarchy call-site range consumes
one unit of the same collector fact allowance. `factUnits` records that charge;
the collector's `facts` metric includes those related range units. A subsequent
observation cannot reopen a per-call range allowance. Budget exhaustion retains
the bounded raw response and explicit projection omissions, without claiming
complete projected hierarchy evidence.

Incoming call-site ranges must belong to the returned caller item; outgoing
ranges must belong to the captured request's caller item. Both the range and
that caller's enclosure need exact source coordinates. Missing/malformed range
lists and unqualified/outside caller ranges keep the observation partial. A
separately exact target remains target evidence, without promoting an invalid
call origin.

Shared lspBindings26 retires the changed request and range projection meaning in
the existing semantic policy. These process-local tokens are not durable
capabilities and introduce no new public request or configuration surface.

The authored regressions use the actual collector with controlled transport
promises and source callbacks. They are unvalidated and do not establish a live
server, process-lifetime, language or application qualification result.
