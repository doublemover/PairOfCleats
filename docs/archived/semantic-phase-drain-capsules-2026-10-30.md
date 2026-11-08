# Semantic phase drain and compiler revocation capsules — 2026-10-30

The [runtime receipt](windows-native-phase-closeout-2026-10-30.md) qualifies
the corrected source at `b55c76ac4`: complete production drain passes three fresh
cases in29.568/28.941/29.088s; independent compiler revocation passes12.863s.
At `4a6dbb672`, both partition fixtures failed before the drain because the
source-ready witness incorrectly expected physical `repo/input.ts` in the
compiler closure. Their historical author-workspace logs are under
`.testLogs/run-1793364712232-7s7964/`; the actual root was canonical
`repo/.poc-vfs/input.ts`. Corrected independent VFS expectations and complete
initial/fresh equality assertions now pass without removing provenance fields.
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
The two program roots are canonical VFS identities, including the whole-file
`.poc-vfs/input.ts` alias, rather than two physical source paths. The fixture
independently derives the Vue segment identity from the authored script text,
`embedded`/`typescript` UID domain and exact UTF16 range44–112, then checks its
full VFS path and text hash. It calls the original VFS path and TypeScript root
alias owners against these expected identities, and requires the actual sealed
roots and closure to contain exactly those two VFS documents plus the three
named installed libraries. The physical plain-TS container remains `input.ts`.
This corrects the original source-ready fixture's mistaken physical-root
expectation; it does not change or normalize away any field in the raw compiler
inventory or the initial/fresh verifier-input equality assertions.

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

The recorded candidate passes both IDs under the unchanged deadline. That
bounded result does not replace any other mapped drain authority, cancellation,
publication, native or compiler controls, or establish broad performance claims.
