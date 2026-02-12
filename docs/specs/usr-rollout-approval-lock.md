# USR Rollout Approval Lock

Status: Draft v0.1
Last updated: 2026-02-12T08:35:00Z

Purpose: define the authoritative approval lock for rollout readiness and test-rollout authorization decisions referenced by `TES_LAYN_ROADMAP.md` Gate C controls.

## Approval lock

Approval record ID: `usr-rollout-approval-pending-2026-02-12`
Approval scope:
- readiness approval state for `Readiness report approved.`
- rollout authorization state for `Test rollout authorized.` and `conformance rollout authorized.`
- gate prerequisite acknowledgement that Gate A and Gate B8 evidence controls remain green at approval time

Approval state: `pending`

Required approver roles:
- `usr-architecture`
- `usr-conformance`
- `usr-operations`

| Role | Decision | Updated at |
| --- | --- | --- |
| `usr-architecture` | pending | 2026-02-12T08:35:00Z |
| `usr-conformance` | pending | 2026-02-12T08:35:00Z |
| `usr-operations` | pending | 2026-02-12T08:35:00Z |

## Promotion rule

The lock may transition from `pending` to `approved` only when:

1. `Readiness report approved.` is checked in `TES_LAYN_ROADMAP.md`.
2. `all prior gates pass.` is checked in Gate C checklist.
3. all required role decisions are `approved` with ISO 8601 timestamps.

If any role decision is downgraded or missing after approval, the lock is invalid and rollout authorization must be reopened.

## References

- `TES_LAYN_ROADMAP.md`
- `docs/specs/usr-core-rollout-release-migration.md`
- `docs/specs/usr-core-evidence-gates-waivers.md`
