# Shared Module Boundary Waivers

- Scope: temporary exceptions for `#430` architecture guardrails
- Purpose: make the current `src/** -> tools/shared/**` debt explicit while preventing new drift

## Active rule

- `src-imports-tools-shared`
  - Runtime `src/**` code must not depend on `tools/shared/**` unless the exact importer/shared edge is listed in the waiver JSON.

## Why this exists

- The shared-module review and scan program found a small number of still-live runtime imports from `tools/shared/**`.
- Those edges are real migration debt, but they should not block the enforcement rollout for newly introduced drift.
- This file makes the remaining exceptions auditable and lets the guard fail when:
  - a new unapproved edge appears
  - a stale waiver remains after the edge is removed

## Expected maintenance

- Remove waiver entries as soon as the corresponding import is migrated.
- Do not add new waivers without tying them to a concrete H31/H32 migration or reduction task.
