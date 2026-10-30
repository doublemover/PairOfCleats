# Semantic phase drain and compiler revocation capsules — 2026-10-30

Source preparation only: the partition and new equality assertions have not run.
The author-workspace `.testLogs/consumer-wave-next-20261030/phase-default-final-1*`
receipts are historical, unavailable in a clean checkout, and remain failed
deadline evidence. That invocation completed its assertions and naturally exited
zero, but crossed the unchanged 30-second parent deadline. Its initial normal
Stage2 took 10,397ms, the complete two-phase drain took 17,073ms, and diagnostics
finished at 29,940ms before the original root cleanup. No passing runtime result
is inferred from those observations.

The retained `indexing/semantic/phase-drain-production` ID still executes the
normal deferred Stage2 and one normal whole-generation drain selecting both
`localFlow` and `crossFileFlow`. It preserves two exact lineage entries, compiler
parse/source-byte reuse and fresh parses, only two completed task receipts,
selected source phase coverage, and exact embedded-source mapping. Its existing
lane and ordered membership remain unchanged.

Only the final strict-tsconfig mutation and public-service
`ERR_SEMANTIC_DEPENDENCY_UNSEALED` assertion move to
`indexing/semantic/phase-drain-compiler-revocation`. That independent fixture
builds its own original deferred Stage2 through the same shared setup owner,
checks a full healthy public plan, changes the exact original strict config,
and requires rejection while the original published manifest stays unchanged.
It has an explicit integration lane rule and a `ci` ordered source entry. The
generated ordered manifest must be refreshed by the publication owner. No npm
script aliases or script-coverage claims change.

Both fixtures use [the same setup](../../tests/helpers/semantic-phase-fixture.js):
the original TypeScript function, exact Vue script, real installed ES5 and two
decorator libraries, single thread, disabled worker pool, rich semantic profile,
and all three compiler phases deferred. No eager phase, reduced source corpus,
synthetic grant, dependency override, retry or larger test deadline is introduced.
Each observed compiler closure must contain the same five program sources plus
the tsconfig member; its config read hash must match the authored original bytes.

The authority equivalence proof is explicit in the healthy fixture:

- Both generations' task targets pass the original `openEnrichmentInventory`
  and `verifyEnrichmentTask` owners, including registered target bytes, checksum,
  canonical target identity, task dependency hash and syntax references.
- The complete `compilerInventory` for all three task kinds is compared, with
  no path, probe, compiler receipt, source, VFS, closure or tooling field removed.
  The actual compiler verifier input is exactly `{ inventory, repoRoot,
  toolingConfig }`; those complete inputs and their canonical hashes must match
  across initial and drained inventories. Generation belongs to the enclosing
  target, not the compiler inventory.
- Actual `status:published`, two selected lineage entries and exact completed
  receipts require the original service's `beforePublish` and recovery paths.
  Those paths reverify original dependency authority, compare the fresh task
  inputs and policy, and validate fresh registered targets. The fixture binds
  its old/new dependency hashes, task-input hashes and completed receipts to
  that successful original publication. This is positive fresh authority
  evidence without another expensive full public plan after the drain.

Thus moving the config negative does not substitute a different authority
contract: its independent setup supplies the same sealed compiler input shape,
while the healthy case proves exact old/fresh input equality and successful
normal publication. The negative still calls the public service with its real
persisted generation and the original verifier; no injected authority is used.

Run the two affected IDs separately after publication with the pinned Node26
runtime and normal bootstrap:

```text
node tests/run.js --lane all --match indexing/semantic/phase-drain-production --jobs 1 --timeout-ms 30000 --retries 0
node tests/run.js --lane all --match indexing/semantic/phase-drain-compiler-revocation --jobs 1 --timeout-ms 30000 --retries 0
```

Both must pass on the final candidate. This source partition is not passing
performance evidence and does not replace any other mapped drain authority,
cancellation, publication, native or compiler controls.
