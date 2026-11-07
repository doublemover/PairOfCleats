# Normal-map original work prerequisites

Each loader-returned texture has an exact captured texture capability and a
separate loader guard. Original load/configuration/publication work is retained
by both. A caller holding the texture's scoped capability cannot bypass later
observed work by invoking its explicit release directly. Actual native disposal
or failed-close retry waits for the original prerequisite observations. Successful
physical disposal, including an original fulfilled promise, remains remembered
when later work delays closure confirmation.

Prerequisite traversal uses the existing resource and cleanup composition
producers' private identity records. Only a privately produced wrapper's own
scene closure observer is delegated, and only the exact local texture/guard
resource failures may delegate their resource closure. Every original
constituent, cache channel and diagnostic/ownership-inspection value is visited
independently. An identical function in a cache channel remains independent.
Unknown ownership capture remains unknown even when its separately thrown
diagnostic later settles. The original functions and receivers remain captured;
first evidence may attach to a previously absent channel.
Cleanup compositions keep every original snapshot predicate, including snapshots
whose ownership channels were absent when the composition was first created.
Later admission of first evidence therefore remains visible in the original
composition's full ownership observation.

Public owner/cause/error fields, copied callbacks and known membership of one
constituent cannot authorize observer removal. A foreign real resource producer
retains its full original observer; the local owner never reconciles a sibling
resource automatically. The local traversal retains at most 128 distinct
original values and examines at most 256 constituent/inspection links per
admission; excess work remains unconfirmed. This is an
observation bound, with no inferred native settlement.

The explicit original-work receipt describes prerequisites for local retirement,
not native closure. Full failure outputs continue to carry the actual native
and guard capabilities and their closure observations. Ordinary retirement and
late callbacks do not retry known failed native closes. Explicit resource
reconciliation still requires all original work and remembers successful closes.

Additional actual-owner controls cover known resource/aggregate wrappers with
independent cache and diagnostics, mixed unknown work, copied lookalikes,
dual-channel aliases, throwing ownership inspection, async success with late
work, foreign producers and successful-close retention. All new source and
assertions are **UNVALIDATED**. No tests, syntax/lint/format, bootstrap, native,
child, browser, loader/network, Three/GPU/model or benchmark execution was run.
No real loader cancellation, native/GPU quiescence, retry safety, allocation,
host, memory bound, quality or performance qualification is claimed.
