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
