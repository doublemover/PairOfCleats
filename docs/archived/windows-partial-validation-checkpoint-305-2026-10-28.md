# Checkpoint 305: partial Windows validation

The frozen candidate was `f06e103ce6e823a41b14431a3b30e05f293b0102`,
tree `e1389bee3290f52fdbba0eeff5867b7c0fcac3f9`, on Node 26.12.1,
Windows x64, ABI 147. Discovery found 6,160 fixtures: 6,102 required and
58 explicit platform/helper/optional exclusions with their coverage owners.

**The user stopped broad execution and requested focused failure rechecks.**
The 68 completed cohorts contain 2,652 results: **2,606 passed, 46 failed,
including five timeouts, and none skipped**. Another 3,450 planned required
fixtures have no completed report. Cohort `069-performance-perf-2` was
interrupted; its console output is not counted as passing evidence. No further
full-suite run is scheduled.

The [durable receipt](windows-partial-validation-checkpoint-305-2026-10-28.json)
retains every completed result, failure/log hashes, unrun ID, explicit exclusion,
cohort command policy and original report hash. Original failure receipts remain
intact. Correctness used bounded concurrency; native lifecycle and performance
ran serially. Fixture deadlines were 30 seconds, indexing used one thread,
retries were zero and native-status redo was disabled. Completed reports record
no access-violation exits; this does not qualify unexecuted lifecycles or attribute
an unrelated native crash.

The [complete checkpoint-265 baseline](windows-full-validation-checkpoint-265-2026-10-28.md)
remains the earlier exhaustive run, with 5,819 passing and 279 failing fixtures.
Neither run establishes a current-tree full-suite pass. Repairs now use original
failing cases and direct regressions, retaining strict positive/negative contracts
and unchanged deadlines. Cheap publication gates remain separate from suite reruns.

The receipt also reconciles 20 independently qualified GitHub closures, preserving
their source-bound comments and completed-state readbacks: #980, #981, #997,
#999, #1007, #1023, #1026, #1047, #1052, #1105, #1116, #1117, #1469,
#1550, #1576, #1609, #1681, #1716, #1732 and #1738. The remaining inventory
is **688 open: 452 qualification-pending, 147 partial and 89 unresolved**.
These closures do not imply that this partial campaign passed their entire
acceptance scope. Raw `.tmp/` paths are historical author-workspace locations.
