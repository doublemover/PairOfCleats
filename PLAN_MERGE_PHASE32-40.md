# Plan

We will merge phase32-40-haircut into main in a clean state, then run formatting/linting and the full test suite. We will fix test failures where reasonable, log unresolved issues into a merge-specific roadmap phase, update completed phases, and finalize with a commit and push.

## Scope
- In: merge phase32-40-haircut, resolve conflicts, format/lint/fix, run all tests, log failures, update roadmap/completed phases, commit + push.
- Out: new feature work outside the merge, unrelated refactors.

## Action items
[x] Verify main is clean; capture current HEAD and branch state.
[x] Review merge diff summary (files/areas impacted) to anticipate conflicts and coverage needs.
[x] Merge phase32-40-haircut into main; resolve conflicts if any.
[x] Run npm run format and npm run lint; fix lint issues (max-lines currently failing in tests/script-coverage/actions.js, defer per instruction).
[x] Run tests in smaller batches (unit lane passed; services lane failed mcp-robustness/mcp-schema/api health; api-server-stream excluded). Log failures to roadmap.
    - Re-run the single test to confirm.
    - Try 1-3 targeted fixes (docs/config/test updates) and re-run.
    - If still failing, capture the exact error/output, repro command, and suspected module.
[x] Add a new "Merge Phase 32-40" phase to NEW_ROADMAP.md with failure tasks and detailed subtasks.
[x] Update NEW_ROADMAP.md completion checkboxes; move completed phases to COMPLETED_PHASES.md (append).
[ ] Commit the merge and fixes; push main.

## Open questions
- None.
