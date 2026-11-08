# Compiler finally completion destinations

The compiler CFG has separate terminal destinations for ordinary fallthrough and
completed return. Both remain canonical `exit` blocks. A return from a try block
continues through the existing finalizer route to the return destination. A
locally caught throw, inner loop break or inner continue in that finalizer leaves
that destination intact. An escaping labeled break/continue chooses its actual
outer destination; it can cancel the suspended return and reach ordinary
fallthrough. A replacement return or escaping throw keeps its own completion.

Existing finalizer routes have internal suspend/resume markers and a lexical
finalizer depth. A bounded completion traversal records the current source
return origin and suspended outer origins. Normal finalizer completion restores
its saved origin. A locally caught throw clears its own current completion;
escaping a finalizer drops the saved entries it leaves. This also distinguishes
an inner return cancelled by a throw from an outer return restored after that
throw is caught locally. Only origins reaching the return terminal become
explicit return channels; reaching the separate ordinary terminal establishes
fallthrough. This replaces the global pending-return boolean. Expression-bodied
functions use the same return destination. No source value is reconstructed or
executed, and no new public block kind, storage owner or schema field is
introduced.

Authored controls inspect the actual compiler CFG, retained return/undefined
rows and canonical call-dependency summary consumer for local and nested catches,
inner loops, escaping labeled breaks/continues, conditional cancellation,
replacement returns, throwing finalizers and expression bodies. The shared
`cfgFlow` identity must advance because retained completion alternatives and
their parameter-to-return channels change. Call-summary implementation, source
syntax, bindings, value-slice and LSP identities are unchanged.

The existing finalizer memo/construction budgets and conservative coverage
remain. Completion frames are admitted before queueing under the existing CFG
byte allowance and reaching-definition work allowance. Exhaustion records
`completion_state_work_or_byte_budget`; observed completion witnesses remain
partial and no summary can claim completeness. These are owner admission
allowances, not a process-memory bound. This is no claim of precise path
feasibility, iterator close/async semantics, arbitrary runtime exceptions or
complete source-language finalizers.
All controls are **UNVALIDATED**. No tests, syntax, format, compiler/native/source
execution, bootstrap, builds or benchmarks were run.
