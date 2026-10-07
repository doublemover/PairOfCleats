# DEPRECATED

- Canonical replacement docs: `docs/roadmap.md`, `docs/roadmap-release-validation-plan.md`, `docs/specs/unified-syntax-representation.md`, and the schema/validator contracts under `src/contracts/**`.
- Reason: the approval lock modeled non-technical role signoff as a release-readiness blocker. Current branch completion is governed by local technical validation, release checks, and standard CI evidence instead.
- Archived status: historical only; this file is not an active release blocker and must not be consumed by release readiness tooling.
- Deprecated: 2026-05-22, branch `NEON_TIDE`, commit `c9ed8d17a` plus current worktree cleanup.

# USR Rollout Approval Lock

Status: Historical archived approval lock (inactive)
Last updated: 2026-05-22T00:09:02Z

Purpose: preserve the former approval-lock record for historical traceability; current rollout readiness is decided by the replacement technical validation docs named above.

## Approval lock

Approval record ID: `usr-rollout-approval-pending-2026-02-12`
Approval scope:
- readiness approval state for `Readiness report approved.`
- rollout authorization state for `Test rollout authorized.` and `conformance rollout authorized.`
- prerequisite acknowledgement state for `Gate C approvers acknowledge current Gate A/B/B8 evidence.`

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

1. all required role decisions are `approved` with ISO 8601 timestamps.
2. the approval evidence bundle records Gate A, Gate B1-B7, and Gate B8 as green for the current branch.
3. no active waiver or release blocker contradicts rollout readiness.
4. this file includes an explicit `Approved evidence bundle:` line naming an existing safe repo-relative evidence bundle used for the decision.

The `docs/roadmap.md` Gate C checklist rows are downstream status anchors, not prerequisites for approving this lock. They must remain unchecked while this lock is pending, and may move only after the approval lock is valid and post-edit validation passes.

If any role decision is downgraded or missing after approval, the lock is invalid and rollout authorization must be reopened.

## Local prerequisite evidence

Current local evidence does not approve the lock. It records only the implementation and technical-documentation state that approvers can review before making role decisions.

- Gate A/B reconciliation remains green in `temp/validation/usr-gate-reconciliation-20260520-130953.log`.
- Language/framework technical checklist coverage is green in `temp/validation/usr-contract-checklists-20260521.log`: 39 language contracts and 8 framework contracts have matrix linkage, complete edge-case linkage, concrete fixture IDs, required fixture-family coverage, and executable conformance-lane mappings.
- Current USR gate validation is green in `temp/validation/usr-gate-current-validation-20260521.log`: 13 focused selectors passed with 0 failures, 0 timeouts, and 0 skipped; generated matrix baseline drift check also passed.
- Owner-role and backup-owner checklist rows remain pending in `docs/specs/usr/languages/**` and `docs/specs/usr/frameworks/**` until the required approval roles record decisions here.
- Template files under `docs/specs/usr/languages/TEMPLATE.md` and `docs/specs/usr/frameworks/TEMPLATE.md` are placeholder scaffolds, not active contract status. They intentionally avoid Markdown checkbox syntax and are guarded by `tests/tooling/docs/usr-contract-checklists.test.js`.
- `docs/roadmap.md` carries the explicit pending Gate C checklist anchors named by this lock, including the approver acknowledgement that current Gate A/B/B8 evidence is green, and `tests/tooling/docs/usr-contract-checklists.test.js` verifies those anchors remain unchecked while `Approval state` is `pending`; focused validation is in `temp/validation/usr-gate-c-checklist-anchor-validation-20260521.log` and `temp/validation/roadmap-contract-gap-cleanup-validation-rerun-20260521.log`.
- The current local handoff bundle is `docs/roadmap-release-validation-evidence-20260521.md`, captured at `2026-05-21T22:41:33Z`; its release-readiness and evidence-integrity guard validation is in `temp/validation/release-readiness-usr-approval-lock-validation-20260521.log`, release local-gap hardening is in `temp/validation/release-readiness-local-gap-hardening-20260521.log`, phase/target readiness hardening is in `temp/validation/readiness-gate-phase-target-hardening-20260521.log`, clean TUI target-config readiness hardening is in `temp/validation/readiness-gate-tui-target-config-final-validation-20260521.log`, the current pending-approval readiness proof is in `temp/validation/readiness-gate-current-pending-approval-validation-20260522.log`, the final evidence-citation guard is in `temp/validation/readiness-pending-evidence-citation-final-20260522.log`, the release evidence table sync guard is in `temp/validation/roadmap-evidence-table-sync-20260521.log`, the exact referenced-evidence path audit is in `temp/validation/roadmap-current-completion-audit-20260521.log`, the durable active-doc filesystem-reference guard is in `temp/validation/roadmap-reference-guard-handoff-final-20260521.log`, duplicate-ledger/brace-path guard hardening is in `temp/validation/roadmap-dup-ledger-brace-guard-final-20260522.log`, the approval handoff link is guarded in `temp/validation/usr-approval-current-evidence-handoff-validation-20260521.log`, and approval-lock evidence-log existence is guarded in `temp/validation/approval-lock-evidence-log-existence-20260521.log`.

## Approval review package

Approvers should review the current branch, not the historical intent of the USR program. Before recording a decision, use `docs/roadmap-release-validation-evidence-20260521.md` as the current local evidence bundle named by `docs/roadmap-release-validation-plan.md`, and confirm that the following local prerequisites still hold:

1. `docs/roadmap.md` keeps USR rollout status at `in progress` and does not claim rollout authorization.
2. `docs/specs/usr-consolidation-coverage-matrix.md`, `docs/specs/usr/README.md`, and every active language/framework contract remain aligned with the schema-backed matrix and checklist tooling.
3. `temp/validation/usr-gate-current-validation-20260521.log`, or a newer replacement evidence log, shows the required USR selectors passing with 0 failures, 0 timeouts, and 0 skipped.
4. `node tools/usr/generate-usr-matrix-baselines.mjs --check` passes in the approval evidence bundle or is replaced by a newer equivalent generated-matrix drift check.
5. No active waiver or release blocker in `docs/roadmap-release-validation-plan.md` or the current release evidence bundle contradicts rollout readiness.
6. The evidence bundle records whether it was captured against a clean committed SHA or against branch-local uncommitted changes. If it was captured with uncommitted changes, approvers must either accept that state explicitly for the handoff or require a fresh clean-worktree evidence rerun before approval.

Role-specific review focus:

| Role | Required review focus |
| --- | --- |
| `usr-architecture` | Contract/schema ownership, matrix structure, compatibility policy, and absence of unapproved breaking changes before rollout. |
| `usr-conformance` | Language/framework coverage, conformance-lane mappings, fixture-family evidence, and checklist completeness across active USR docs. |
| `usr-operations` | Release-readiness procedure, rollback/reopen rule, approval evidence durability, diagnostics/security evidence, and operational handoff clarity. |

## Approval update procedure

Only a real role decision may update this lock. Do not set `Approval state: approved` from local tests alone.

When all required reviewers approve:

1. Update each role row from `pending` to `approved` with the decision timestamp.
2. Change `Approval state: pending` to `Approval state: approved`.
3. Add an explicit `Approved evidence bundle: ` line naming the existing safe repo-relative evidence bundle used for the decision.
4. Re-run the USR gate validation and generated-matrix drift check after the approval edit.
5. Re-run the release readiness gate, which validates this file by default and reports structured `usrApproval.*` blockers while the lock is not approved.
6. Only after the approval lock is approved and post-edit validation passes may `docs/roadmap.md` move USR readiness/rollout authorization out of its pending state and update the Gate C checklist rows.

If any reviewer declines, cannot verify the evidence, or finds drift after approval, keep or return `Approval state` to `pending`, leave the affected role row non-approved, and reopen the USR rollout readiness work in `docs/roadmap.md`.

## References

- `docs/roadmap.md`
- `docs/specs/usr-core-rollout-release-migration.md`
- `docs/specs/usr-core-evidence-gates-waivers.md`
- `tests/tooling/docs/usr-contract-checklists.test.js`
- `tools/release/readiness-gate.js`
