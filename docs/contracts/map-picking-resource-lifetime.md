# Resident picking resource lifetime

The actual resident picker captures each returned index and fence's original
disposer and operation methods. A later replacement of those fields cannot
replace the captured callable or its receiver. Existing resident resources first
observed by the picker are captured once; error metadata and reported owner
fields never supply disposal authority.

Retirement captures both original resources, revokes old picking publication
and detaches their exact state slots before invoking either disposer. Every
independent original cleanup is attempted even when another fails. Reentrant
disposal may install a new picker; old cleanup does not reread or clear those
replacement resources. Failed or unfinished owners remain in the existing
scene-resource inventory with their exact errors and independent observers.
Repeated ordinary retirement reports a failed owner without retrying physical
disposal. Explicit reconciliation uses that original inventory capability;
successful physical disposal is not repeated.

Controls use an original scoped picker; their teardown and fence cancellation
never adopt a later current resource. Exact original resource capabilities are
shared with authoritative geometry retirement, preventing duplicate physical
disposal across those actual owners. See
[original map controls retirement](map-controls-original-retirement.md).

The picker also retains accepted synchronous calls until their original stack
returns. Reentrant retirement during capture/query/intersection/acceptance can
revoke publication immediately, but disposal waits for those calls. Original
operation failures and their independently observed pending work become cleanup
prerequisites. A newer picking invocation has its own publication generation;
an older callback cannot apply metrics or close resources claimed by that newer
invocation. Source, geometry, scene, renderer and exact index/fence membership
are checked around callbacks. A stale constructor's returned resource is retired
through its original capability without adopting a replacement scene's fields.

This implementation and authored inert actual-owner/fence controls are
**UNVALIDATED**. No test, syntax/lint/format, bootstrap, Three/native import,
browser, GPU, build or benchmark was run. It does not establish physical GPU
quiescence, safe retry after native failure, inaccessible partial constructor
cleanup, real controls-host acceptance, asynchronous picking backend support or
pointer latency/performance acceptance.
