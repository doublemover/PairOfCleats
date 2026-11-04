# SQLite qualification boundary repair — 2026-11-04

The original 65-capsule campaign at clean `e82e33bfe` stops after three passes:
the 167,936-row seed times out at the unchanged 30-second child deadline.
Its synchronous trace records 3.256s of source admission, a complete 23.661s
native build/checkpoint/close, then the start of independent validation.
The original failure, complete phase trace and confirmed forced child exit
remain in the [machine receipt](windows-sqlite-boundary-repair-2026-11-04.json).

A diagnostic observation of that retained database completes full validation
in 4.972s after 3.617s of fresh source admission. It checks all 167,936 chunks,
1,343,488 postings, 328 file identities, lengths, filter facts and expected FTS
hits. This is diagnostic evidence about the aggregate wrapper, not acceptance
of its failed invocation or a measured production speedup.

The internal controller now follows the existing native lifetime boundaries.
Each complete seed/build transaction, checkpoint and close stays indivisible;
full validation of its closed database follows in a separately bounded child.
Each incremental arm receives its own native backup and complete initial
validation, then retains the same database through all three original atomic
update transactions, each followed by full validation. No mutation round,
source admission, query assertion, paired content comparison or cleanup owner
is removed. Mutation-only receipts explicitly remain unvalidated.

Coverage is conserved as 199 serial children: three preparations, two seed
builds and two seed validations, 48 build-arm phases, and 144 update-arm phases.
They retain all 30 paired trials, 60 arms and 132 measured build/update samples.
Large/high and large/low still prove their initial manifests identical. Each
child retains 30 seconds, zero retries and no native-status redo. Process/JIT
warmth changes between update rounds; file/database warmth remains uncontrolled.
No whole-wrapper historical latency comparison is inferred.

All 14 affected cases pass, including all three public benchmark entrypoints
in baseline/current/compare, actual initial/updated fixture admission, bounded
phase admission, native phase/close ownership, cohort conservation and multirow
build parity. The new native control compares the complete split observation
with the original wrapper; missing validation cannot qualify a mutation.
The repaired full campaign remains pending. Public CLI/configuration, runtime
admission, latency thresholds and the all-or-nothing incremental transaction
are unchanged. Author `.tmp/` and `.testLogs/` paths are historical receipts.

## Native incremental follow-up

At clean b5f08e95f,32 capsules pass before the first large/high update times
out inside its original transaction. The source owner issues a separate delete
for every changed/deleted file; postings have a mode-leading key, so each group
repeats a broad native scan. A real8192-row/32-file regression observes nine
postings deletes and fails its one-pass work assertion with the original owner.

The update now groups the already-captured stale-file ID arrays and uses the
existing2000-ID temporary-table path once. It retains references to those arrays
instead of flattening another full ID copy. Small groups and transformed optional
ANN targets keep their original binding paths. File identity, deterministic ID
reuse and all deletion/insertion work remain within one original transaction.
Temporary-table cleanup failures now remain visible alongside the primary error.

The repaired owner regression proves one native postings delete, complete
updated content/FTS/filter parity and one outer BEGIN/COMMIT. A forced original
delete failure plus cleanup failure retains both exact frozen errors and one
BEGIN/ROLLBACK; full original database observations remain equal afterward.
All four affected fixture/admission/phase/FTS cases pass. Actual high-change
requalification remains pending; no time-bound relaxation or retry is used.

Seven further identity, transaction, Unicode, query/update and handle controls
pass, including real doc-ID reuse25.0s and update/search23.6s. All eight
publication checks pass, including41 gate cases. The initial generated-table
launch used host Python; the preserved refusal passes with the repository
CPython3.15.2 launch, with no generated-table changes.

## Final lifetime partition

At ec78f3cb2,38 high-change capsules pass before trial5 baseline round2
times out during full validation. Its native transaction/checkpoint/close
completes20.706s after3.117s of independent source preparation. The failed
aggregate remains failed. Every native mutation and its complete validation
now have separate30-second children, preserving all60 arms and132 samples
in307 serial cases. Independent update rounds keep the same database and
original atomic transaction; no mutation or content comparison is dropped.

Preparation captures hash-bound planning statistics for all four immutable
source states. Mutation-only children use those counts/bytes for the existing
ingest plan and still execute production snapshot admission. The independent
validator recaptures canonical source facts and checks the planning values;
serialized planning metadata never serves as a validation capability. The
private capture advances to schema2 and rejects old captures. This removes
duplicate oracle cloning from mutation-only children without changing native
operation clocks, source authority, workload sizes or latency thresholds.
The resulting complete campaign remains pending.
