# Plan

We will finish Phase 12 by closing any remaining SQLite/LMDB backend gaps, aligning docs with actual behavior, and validating via storage tests. Track progress in this file as each subtask completes.

## Scope
- In: Phase 12 storage backend items (SQLite build/incremental/validation, LMDB reader/build, docs/tests).
- Out: Non-storage phases or unrelated CLI/UI changes.

## Action items
[ ] Audit unchecked Phase 12 items in `NEW_ROADMAP.md` and map each to concrete files/tests.
[ ] Close remaining SQLite gaps (incremental WAL policy, manifest rules, fail-closed checks, perf fixes) and update storage docs.
[ ] Close remaining LMDB gaps (reader schema mismatch handling, required key validation) and update LMDB docs.
[ ] Add/adjust tests covering remaining Phase 12 requirements (SQLite ANN existing table, dims mismatch hard-fail, WAL checkpoint, reader fail-closed).
[ ] Run storage validation (`npm run test:storage` plus focused SQLite/LMDB tests) and log/stop after a few attempts if unresolved.

## Open questions
- None.
