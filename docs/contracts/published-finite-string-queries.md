# Published finite-string type queries

Implementation status: UNVALIDATED. The authored regression additions have not been executed.

The existing semantic detail surface reads symbolic type graphs from the exact requested published generation, including builds with the canonical semantic family disabled. Piece registration, content identities, graph/context/node references and finite-string engine budgets remain the admission owners. Membership and classification describe declared finite-string denotations; they do not establish native assignability, effects or whole-language type closure.

A store's opening signal and each query's operation signal combine through the shared cancellation owner. Both cold graph reads and queries against an already hydrated graph observe the combined signal. An operation cannot override an aborted store owner with a live signal. Operation and membership inputs are pinned before awaited graph acquisition.

The public semantic detail runner forwards its operation signal into each type query, checks cancellation around awaited store/query work and before returning a complete response, and retains the existing shared response byte allowance and absolute work deadline. Cancellation cannot become a complete negative membership result. Graph hydration and witness construction retain their existing independent engine budgets; this does not claim serialized concurrent store use, a shared multi-query step counter or process-level performance qualification.

`indexing/artifacts/symbolic-types-roundtrip` authors already-hydrated local abort, bound-owner abort and late-settling public response regressions alongside the existing published writer/store/detail/CLI path. No published generation or real compiler run was exercised for this source release.
