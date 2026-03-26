# Shared Module Reduction: #432

- Issue: `#432`
- Title: `Shared-module findings reduction and prioritized implementation backlog`
- Reduced: `2026-03-26`

## What this does

This backlog reduces the H30/H31/H32 output into a smaller execution queue grouped by engineering value instead of discovery order.

## Priority order

1. `P0-tools-shared-runtime-exit`
   - remove the remaining runtime `src/** -> tools/shared/**` imports tracked by the boundary waivers
   - this is the highest leverage follow-on because `#430` already made new drift fail fast

2. `P1-root-shared-deflation`
   - split the overloaded `src/shared` root bucket
   - remove cross-layer re-exports and specialized progress/domain helpers from the generic root

3. `P1-artifact-io-and-storage-split`
   - break up `artifact-io`, bundle/file helpers, and schema-oriented storage helpers by responsibility

4. `P1-concurrency-and-subprocess-core`
   - split the correctness-critical lock/process/progress/controller modules into narrower units

5. `P2-cli-dispatch-capability-cleanup`
   - simplify display/render/registry/capability ownership and finish the dispatch env cleanup

6. `P2-adoption-and-hoisting-follow-through`
   - use the scan artifacts and duplicate-cluster seeds to drive the next set of targeted migrations

## Why this sequence is best

- The boundary-waiver debt is already observable and guarded, so removing it now gives immediate architecture hardening.
- The next highest-risk areas are the big shared families used on critical runtime paths: root shared, artifact/storage IO, and subprocess/concurrency.
- CLI/dispatch cleanup matters, but it is less likely to cause correctness regressions than the runtime families above.
- Broad follow-through adoption work should use the new guards and codemods rather than proceeding as a fresh discovery pass.

## What to defer

- generic hoisting of every duplicate filename stem
- broad semantic codemods
- stricter boundary policies before the currently-waived runtime debt is gone
