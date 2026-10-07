# Shared-module Ownership and Batch Status

Issue: #432
Status: Checkpoint clean
Documentation consolidated: 2026-10-02
Canonical execution queue: [roadmap](../../roadmap.md)

The [machine-readable backlog](432-prioritized-implementation-backlog.json) retains
batch IDs, dependencies, acceptance criteria and source-issue provenance. This
page gives their current disposition. The [original implementation worklog](../../archived/432-prioritized-implementation-backlog.md)
preserves the complete authored history and evidence.

## Current status

1. `P0-tools-shared-runtime-exit` - `done`.
   Runtime callers use supported runtime/subsystem owners rather than tools/shared. Boundary waivers and migration recipes remain guarded.

2. `P1-root-shared-deflation` - `done`.
   Oversized root facades were removed or narrowed after consumers moved to focused owners. Public compatibility surfaces remain only where their contract requires them.

3. `P1-artifact-io-and-storage-split` - `done`.
   Artifact selection, row streams, binary decoding, bundle IO, compression and byte/checksum ownership live in focused storage/IO modules.

4. `P1-concurrency-and-subprocess-core` - `done`.
   Process tracking, termination, lock metadata, stale-owner checks and release behavior have narrow owners and focused contracts.

5. `P2-cli-dispatch-capability-cleanup` - `done`.
   Display/layout/frame, command-registry query, dispatch environment and runtime-capability responsibilities are separated.

6. `P2-adoption-and-hoisting-follow-through` - `checkpoint clean`.
   Caller adoption and fixture sharing reached a bounded checkpoint. Fresh correctness findings are handled by their current owners rather than reopening historical rewrite lists.

## Global implementation rules

- Keep runtime code out of tool-only ownership; do not add src-to-tools/shared runtime imports.
- Prefer a narrow existing domain owner over a new generic abstraction.
- Preserve public exports until every supported consumer has migrated; change callers and owner together.
- Use exact import rewrites and behavioral tests. A renamed facade alone is not a correctness improvement.
- Keep generated runtime contracts reproducible. The excluded local inventory reports remain untracked.
- Preserve caller-specific assertions when sharing fixtures or helpers.

## Reopening a Batch

A fresh governance failure, concrete duplicate, correctness defect or measured
performance/import regression can reopen work. Name the failing behavior and
owner, scope the change, retain compatibility intentionally, and record the exact
focused checks. Closed historical acceptance lists are reference material rather
than standing permission for an unbounded refactor.

No known shared-module implementation batch remains open from this backlog.
Current product correctness work and deferred release proof are tracked only in
[the roadmap](../../roadmap.md).

## Shared validation floor

For changes to module boundaries, select the affected contracts and these guards:

```powershell
node tools/testing/shared-module-migration.js --check
node tools/testing/shared-module-cycles.js
node tools/testing/shared-module-performance.js --check
node tests/run.js indexing/policy/shared-module-reduction-files --lane=all --jobs 1 --timeout-ms 30000
git diff --check
```

A status-only edit does not require a new full duplicate audit or benchmark.
Cancel an individual check that exceeds its agreed resource/time budget and
record it as unverified rather than weakening the acceptance criteria.

## Historical evidence

The [archived worklog](../../archived/432-prioritized-implementation-backlog.md)
retains completed slices, discarded/no-adopt choices, original validation commands,
and their failures and reruns. Missing old local logs remain unavailable. The
JSON companion remains in place for machine consumers; this consolidation does
not change batch identities, statuses, dependencies or acceptance criteria.
