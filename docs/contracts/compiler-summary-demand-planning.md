# Plan-only compiler summary demands

`planSemanticSummaryDemand` is an explicit programmatic planning seam exported by
the existing build-frontier owner. Version1 supports one immutable artifact-store
declaration seed with `need:{kind:"return-value-inputs"}`. The request binds its
generation, pinned partition-inventory hash, source ID/hash, analysis policy hash
and broad summary identity. It requires explicit planning limits; extra keys,
query traversal caps, enqueue/execute modes and other need forms are rejected.
There is no new public configuration or CLI switch.

The caller supplies an existing pinned artifact store, registered summary
descriptor/inventory, exact expected compiler identity and existing canonical
task descriptors. Request/context JSON is captured before the first I/O wait.
Reconciliation reads the seed and each selected callee through the actual pinned
store, checks retained source identity and declines mapped or unsupported seeds.
The planner reads only the registered checksum-qualified summary sidecar. Changed
generation, partition inventory, source, policy or dependencies cannot produce
an existing-task proposal.

Planning traverses the recorded callee-summary graph with a visited set. Named,
body-qualified source summaries are supported; unknown targets, anonymous or
computed locators, async/generator domains and widening have explicit unknown
frontiers. Partial/nonconverged evidence retains its blocker. The result carries
body/payload/support/generation identity hashes, existing whole-group frontier
task IDs and their current input/target identities. A task is a proposal requiring
normal target-set, dependency, lease and publication admission, never enqueue
authority. The planner does not create a narrowed task descriptor.

Work units, visited summaries, retained encoded bytes, iterations and a cooperative
elapsed-time deadline are distinct from query traversal budgets. Consumed and
remaining allowances are returned. Zero limits and exhaustion produce partial
unknown frontiers. Encoded metadata admission bounds planner products; underlying
store piece readers retain their own existing byte/lifetime bounds. Cooperative
checkpoints do not claim to forcibly terminate an outstanding native read.
The output is capped at64KiB and contains no AST or native handles.

All current plans remain blocked from execution: #1132 still lacks qualified
information-dependency completeness, cross-generation locator migration and
reuse publication. The result states `analysisExecuted:false`,
`executionAllowed:false`, `enqueueAllowed:false` and
`summaryReuseQualified:false`, with the existing whole-group compiler task as the
fallback. No scheduler, control database, lease, executor or publisher is accepted
by this seam. A read-only plan does not mutate a generation or register work.
Future explicit enqueue/drain integration must revalidate live authority through
the existing owners; an old plan is never a lease or execution capability.

`tests/indexing/semantic/compiler-summary-demand-plan.test.js` authors actual
TypeScript CFG/retained evidence, existing canonical task, repeated/cyclic demand,
unknown target, captured-input mutation, budget, stale identity, cancellation and
no-publication controls. They are UNVALIDATED pending the root-led frozen-tree
validation pass. This establishes a supported planning form, not completed
refinement, eager-result parity, resumable analysis or a measured speedup.
