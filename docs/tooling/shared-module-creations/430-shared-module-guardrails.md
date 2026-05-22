# Shared Module Creation: #430

- Issue: `#430`
- Title: `Shared-module architecture guardrails and CI enforcement`
- Created: `2026-03-26`

## What landed

- New policy guard: [shared-module-boundary-guard.test.js](C:\Users\sneak\Development\DOUBLECLEAT\tests\indexing\policy\shared-module-boundary-guard.test.js)
- New waiver registry: [shared-module-boundary-waivers.json](C:\Users\sneak\Development\DOUBLECLEAT\docs\tooling\shared-module-boundary-waivers.json)

## Why this approach is best

- The generated shared-module ledger already contains the authoritative ownership and consumer-edge data, so the guard can be driven by durable artifacts instead of hand-maintained file lists.
- A narrow waiver-backed boundary rule lets CI fail on new `src/** -> tools/shared/**` drift immediately without pretending the already-known migration debt is gone.
- The same test also validates consumer-map integrity, so stale ledger generation and architecture drift fail in one place.

## What the guard enforces

- every shared-module census entry has exactly one primary owner
- duplicate shared ownership remains empty
- `consumerCount`, `consumerMap.bySharedFile`, `consumerMap.byConsumer`, and `consumerMap.edgeCount` all stay in sync
- runtime `src/**` code cannot import `tools/shared/**` unless the exact edge is waived
- waivers fail closed when they become stale

## What intentionally stayed out of scope

- migrating the waived runtime consumers in the same change
- turning every architecture preference into a hard CI failure
- enforcing broader `src/** -> tools/**` rules before the shared-module adoption work finishes

## Historical follow-up notes

These are not active roadmap tasks. Reopen this family only from a fresh guardrail failure, waiver drift, or shared-module governance refresh:

- remove waiver entries only when current generated ledgers prove the waived edges are gone
- tighten the boundary policy only after current exceptions are proved absent
