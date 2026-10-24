# Original map controls retirement

The controls producer publishes its original disposer before constructing child
owners. It captures the original scene, renderer, child disposal and operation
methods, listener registration/removal methods, and published callbacks. A
partial construction failure retains the exact original cause, including falsey
throws, and independently attempts retirement of every acquired capability.
A listener remover is captured before registration because registration can
install the callback and then throw. An inaccessible resource inside a throwing
constructor remains outside this returned-resource contract.

Returned-child acquisition retains its original disposer before reading any
operation or value capability. Each original getter is followed immediately by
an authority check, and revocation prevents every later getter. Listener setup
checks between the original add/remove getters and after registration; a
registration that installs then revokes construction still has its captured
remover. Publication setters are also followed by an immediate authority check.
Original child facades invoke only while their original controls remain current,
and their accepted native callback stack prevents reentrant physical disposal.
The helper's own acquisition, registration and publication stacks also count as original
accepted work, including when called inside the broader construction span.

Logical revocation expires original callbacks and detaches exact original
publications before native cleanup. Every acquired child is attempted even when
another fails. Fulfilled disposal and listener removal are not repeated. Ordinary
disposal preserves a failed close; explicit reconciliation uses the original
capability in the existing scene-resource inventory. The original synchronous
construction, callback and cleanup stacks are disposal prerequisites. Only an
actual privately registered original scene disposer receives those controls
prerequisites; copied callback properties and matching function shapes carry no
authority. Previous-controls outcomes are scoped to the original receiver and
callback, including a joined original asynchronous close.

The shared scene-work prerequisite walker delegates only exact private local
producer closure. Independent original scene/cache observations and diagnostic
inspection observations remain prerequisites for all acquired controls children,
including a child acquired after the failure. Unknown pending markers, public
owner fields and arbitrary cause/error graphs cannot authorize closure. Original
diagnostic getters and observer functions retain their original snapshot and
receiver. A logical revocation or one-shot failed UI clear does not prove its
desired UI effect occurred.

Each controls instance has a scoped resident picker. Controls shutdown retires
only resources actually captured and still claimed by that owner. It never
snapshots a later scene's picker for disposal or cancellation. Original fence
cancellation methods are captured and fenced like picking operations. A newer
actual claim protects the same exact index/fence from older controls teardown;
an authoritative geometry rebuild and controls teardown share one private
original disposal capability. Accepted original picking stacks gate physical
cleanup. A callback getter that closes the original resource cannot authorize
invocation of its returned function after closure.

The render-loop owner captures each original request, callback, handle and cancel
function. A stale delivered callback cannot render, clear a newer request slot,
or reset its continuous observation. Original request/cancel/render stacks gate
physical closure. A delivered original callback requires no later cancellation.
Failed cancellation retains its exact handle and error, and ordinary disposal
does not retry it. An explicit retry waits for original independent work. An
unreturned or invalid handle remains unconfirmed until the original callback
actually delivers; reported handles, error codes or public owner fields are not
adopted. The browser cancellation contract is void. A non-void cancellation
outcome remains unknown rather than supplying closure proof. No automatic crash
retry or native retry-safety claim is introduced.

Pagehide revokes synchronously and schedules terminal cleanup after the owned
event callback returns. It attempts original controls cleanup and the captured
original scene disposer independently; it never rereads a sibling scene disposer.
Its retained result reports errors and pending capability evidence. Real browser
unload scheduling and final native/GPU settlement remain separate qualifications.

Actual helper, controls, picker, resource-owner and RAF controls are authored
but **UNVALIDATED**. No tests, syntax/lint/format, bootstrap, browser, Three/native
imports, GPU, build or benchmark execution was performed. This source contract
does not establish asynchronous input/render callback support, native failure
retry safety, physical GPU quiescence, pointer latency or performance acceptance.
