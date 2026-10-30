# Managed child original acknowledgement — 2026-10-28

Source `b48e9157cdbe5ca1673dba13ee570177070f41e8`, tree
`198df9c47ffca177cbec720d945c08f4d48b2469`, branch
`codex/pr557-audit-repairs-20261012`. Unpublished; no functional acceptance.

Source inspection found managed children releasing declared-write reservations
from the settlement callback's `settled:true` before the enclosing session
checked its original action/resource observation. A pending result/error could
therefore lose quota accounting while the session correctly retained its asset
leases. Error recovery also inspected arbitrary error properties, reread
fallible observers and could compose recovery from unproven capability fields.

The existing storage session now supplies its first captured action observation
to its settlement owner as a non-enumerable internal capability. Managed child
retirement checks that observation and the captured receipt before dropping any
write reservation. Receipt fields are captured once, with the independent
receipt observation carried through the enclosing acknowledgement. Source/result
getters cannot be resampled as proof of closure. No-start preparation/admission
is distinct from actual child settlement.

The existing admission producer privately associates exact emitted failures with
its actual reservation/recovery owner. Managed creation captures that association
at the original acquisition boundary and captures its own actual session. Copied
fields, matching IDs and arbitrary callback-thrown properties cannot create a
composite admission recovery owner. The wrapper projects only actually acquired
reservations and retains original causes/capabilities through the common
composer. Ordinary mutable failures keep identity when metadata can be added
safely; frozen/different-capability failures keep the original cause. Recovery
uses captured producer methods, stable receipt fields and original metadata
ordering, without spawning another child or acknowledging unknown work.

Eight authored, unexecuted cases use real disposable reservation/lease metadata
with inert action and receipt owners: pending result/error, changing action
getter, pending receipt, receipt-field failure, forged owner, unread capability
getter and preparation failure. They assert quota rows remain until actual
original acknowledgement and only real reservation/session owners are returned.
Existing acquisition-creation/partial-reservation recovery, invalid receipt,
external routing and original preparation-observation fixtures remain required.

Static format/ESLint, changed JavaScript syntax, config budget, command inventory
and whitespace checks passed; shared-module analysis found zero cycles. No
functional fixture, child fixture, native campaign, benchmark or publication
front gate ran. Dependency inputs remain unchanged from the fresh locked
bootstrap in [exact rendered tokens](context-token-budget-implementation-2026-10-28.md).

#1267/#1574 remain partial pending actual session/admission/child/native/category
and complete original/follow-up qualification, plus remaining backend, producer/
publication and cleanup adoption. No public CLI/configuration knob, artifact
format, deletion authority, fabricated child completion or retry workaround is
introduced.
