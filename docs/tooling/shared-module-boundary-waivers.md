# Shared Module Boundary Waivers

- Scope: temporary exceptions for `#430` architecture guardrails
- Purpose: make the current `src/** -> tools/shared/**` debt explicit while preventing new drift

## Active rule

- `src-imports-tools-shared`
  - Runtime `src/**` code must not depend on `tools/shared/**` unless the exact importer/shared edge is listed in the waiver JSON.

## Current status

- As of 2026-05-20, the waiver list is empty.
- `P0-tools-shared-runtime-exit` has no remaining waived `src/** -> tools/shared/**` runtime edges.

## Why this exists

- The shared-module review and scan program found a small number of still-live runtime imports from `tools/shared/**`.
- Those edges were migration debt, and the waiver registry now remains as a guardrail against regressions.
- This file makes any future exceptions auditable and lets the guard fail when:
  - a new unapproved edge appears
  - a stale waiver remains after the edge is removed

## Expected maintenance

- Remove waiver entries as soon as the corresponding import is migrated.
- Do not add new waivers without tying them to a concrete H31/H32 migration or reduction task.
