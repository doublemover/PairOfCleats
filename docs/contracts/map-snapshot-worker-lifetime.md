# Original snapshot worker lifetime

The snapshot client captures the original module worker, its termination method
and its post method once. Request replies and initialization publications retain
the existing snapshot, revision, request and lane fences. Native response fields
are captured before removing their pending request, so a throwing result getter
cannot strand its original dispatch. Original progress still receives its full
initialization envelope.

Retirement revokes new requests first. Queue retirement, each pending dispatch,
the optional disposal post and original native termination are independent
actions. A disposal or cancellation post failure cannot skip dispatch rejection.
Cancellation transport failure also retires the whole client: no replacement or
later query can post to that worker while its original native work is unknown.
A separate client is required for later queries; ordinary successful
cancellation retains the existing client.
Falsey original failures remain exact causes in retained failure evidence. The
existing bounded queue drains its physical slots only as the corresponding
dispatch actually settles.

The client uses the existing scene-resource inventory for its exact worker
owner; its scoped reconciliation property is exposed after client retirement.
Accepted post/callback stacks, dispatches and original independent scene, cache and
diagnostic observations gate native termination. A reentrant disposal retains
unfinished original work. Failed native termination is retained strongly;
ordinary disposal never automatically retries it. Deliberate reconciliation
through that exact resource owner can retry after original prerequisites settle.
Successful termination is retained and is not repeated while resolving a later
independent blocker. A sibling worker, copied owner fields or callback identity
cannot settle the original owner, and explicit reconciliation does not replay a
failed transport message.

The original failure notification is attempted once after pending settlement and
the first termination attempt. Its own failure is retained independently. Late
worker callbacks after retirement have no publication authority. This source
contract does not certify browser worker quiescence, native termination effects,
safe retries after a native crash, inaccessible constructor allocations or an
atomic source snapshot. Data-session publication authority is a separate owner.

Actual client/request-queue and inert original-worker controls are authored but
**UNVALIDATED**. No tests, syntax/lint/format, bootstrap, browser/editor/native,
child/IPC/model/GPU, build or benchmark execution was performed.
