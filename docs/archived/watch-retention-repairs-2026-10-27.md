# Watch retention repair — 2026-10-27

Qualified source: `7c3683ad06dc633b9e0447ab2c232239534a7c64`, tree
`169a1f4fd0529239b4379f6c4be185e926214a20`, branch
`codex/pr557-audit-repairs-20261012`, PR #572. Windows x64, Node 26.12.1.

#690 is completed. Watch pruning now enters both existing repository reader
protocols and the promotion/index lock before deciding disposability. The
launch-selected cache categories remain pinned throughout cleanup. Under that
exclusion it reads the bounded, verified current pointer through the canonical
schema/root owners, protecting primary, mode, legacy-alias and nested stage
references. Unknown authority defers deletion. Coarse live repository readers
can honestly block pruning; they are never dismissed as expired generations.

Creation requires the real writer lease and exclusively creates the attempt.
Outcome admission requires the exact issued handle and confirmed writer
settlement; deletion revalidates its ordinary directory identity. Repeated
outcomes cannot duplicate retention entries or requeue an already removed root
after a logging failure. Post-publication diagnostic errors retain their
existing committed-generation classification.

A failed pointer descriptor close retains its original native recovery owner,
both cleanup exclusions, promotion lock and category session. Recovery first
settles that exact descriptor, then explicitly reconciles metadata ownership;
it does not retry the native read or infer closure from an error label. The
regression verifies that an early reconciliation attempt performs no native
close, and that descriptor closure alone does not release publication authority.

**38/38 affected watch/pointer cases pass**, including all 36 discovered watch
fixtures, with **40/40 gate cases** and the complete cheap pre-push gate.
Formatting/ESLint, configuration/environment, generated freshness,
command/workflow contracts and whitespace checks pass. Checks use one job and
indexing thread, 30-second deadlines, zero retries and native-status redo
disabled. No observed failures, timeouts, skips or native crashes remain in
this batch. The pre-repair manager fails the new retained-reader regression:
retention removes A's shard while its lease is still held.

Coverage preserves the original post-commit, cancellation, normal retention and
mixed-mode controls. New cases exercise both reader protocols, lazy shard
access across B/C publication, close failure, corrupt lease evidence, competing
publication, copied handles, replaced directories and explicit native recovery.
They create ordinary files/directories without physical symlinks or elevation.

The [structured receipt](watch-retention-repairs-2026-10-27.json) records exact
commands, observations, baseline failure and issue readback. Raw
`.tmp/tasks/watch-retention-20261027/` and `.testLogs/` receipts are historical
author-workspace evidence, absent in clean checkouts. Dependencies, patches and
the Node pin are unchanged; earlier clean native/patch verification remains
recorded and current readiness checks pass. Only the inherited missing trusted
config selector is omitted in task children; global/user settings are unchanged.

The live census has **725 open issues**: 464 qualification pending, 147 partial
or follow-up, and 114 with unresolved implementation status. #1267 still owns
broader common lifecycle policy and #1574 still owns custom backend cleanup
adoption. This receipt does not qualify the full suite, Linux/macOS, optional
backends/models, representative performance or release behavior. No WSL or
Linux execution was performed.
