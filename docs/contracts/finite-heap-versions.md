# Finite plain-object heap versions

Unvalidated first slice of #1509. Immutable versions distinguish world, allocation,
region and caller context. Named cells retain explicit presence; a missing cell
remains unknown. Wildcard writes affect later matching reads, while a qualified
definite overwrite cuts off older wildcard contributions for that named cell.
Branch joins retain both predecessor values and unnamed wildcard remainder.

Strong updates require an admitted proof of one concrete live object, matching
world/region/context, exact property, unconditional write, plain data property and
no concurrent writers. A singleton abstract allocation that represents many
objects cannot qualify. These declarations are upstream trusted model inputs,
not public assertions that a checksum can prove.

`src/semantic/heap-values.js` consumes versions for paged may-value explanations.
Pages never claim concrete paths, feasible execution, vulnerability absence or
no-flow. No existing compiler producer or shared analysis version changes.

This finite materialized pilot does not implement compiler CFG extraction,
getters/proxies/native effects, interprocedural alias analysis, dynamic solver
subscriptions, retained version stores, trace/risk publication or incremental
SCC retraction. Capacity rejection is explicit and atomic; it does not itself
provide spill or durable continuation. Those integrations and the independent
concrete-oracle/benchmark campaign remain open. Fixtures are authored, not run.
