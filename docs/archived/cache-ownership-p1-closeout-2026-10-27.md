# Embedding and benchmark ownership qualification — 2026-10-27

Qualified source: `1f7579910e9699e85323c817ffabfa9dc5554b9d`, tree
`2c4ba7e322f208ad9b90b53e50f98ce350ff6d41`, branch
`codex/pr557-audit-repairs-20261012`, PR #572. Windows x64, Node 26.12.1.

This batch closes #1582 and #1746 by qualifying existing production repairs.
Source changes strengthen actual production-runner/CLI coverage; no dependency,
public configuration, format, retry or performance threshold changes are made.

## Embedding channel identity

Three independently bounded runner cases isolate in-memory cross-file reuse,
prior-file reuse and persistent-global reuse. Inert adapters return vectors
derived from exact provider input bytes. Assertions compare every stored
code/doc/merged row at its new ordinal against those inputs, including the
original ambiguous delimiter witness, duplicate multiplicity, identical hits,
doc-only edits with unchanged source bytes and absent documentation. Binary
padding follows the codec's zero point; the authoritative validity mask must
still record absence. Legacy hash versions, Unicode, separators and CRLF/LF
remain covered by existing encoder/migration tests.

The cross-file case has no reusable durable model identity. The prior-file case
removes only its completed disposable fixture's global route, leaving its real
prior-file index/payload. The global case changes filenames and disables
cross-file deduplication. Synthetic model bytes qualify identity, not native
model decoding or quality. Restoring only the old delimiter encoder as a
diagnostic control makes the production cross-file route return A's code vector
for B; the new ordinal byte assertion fails. The real encoder is restored
byte-for-byte afterward. This is an isolated encoder control, not a claim that
the entire historical checkout was executed.

## Benchmark cleanup ownership

The actual CLI runs all modes with default cleanup and explicit keep. Parent
sentinels and preexisting batched/unbatched files survive. Cancellation holds
the CLI's first admitted write and terminates that exact child; retained scratch
does not grant ownership of the caller's container. Additional controls cover
unique concurrent roots, early parent/arm mkdir refusal, replaced directories,
work plus cleanup refusal preserving both errors, and a failed write with a
held sibling that must settle before cleanup or any later batch admission.
All deletion targets are fixture-owned. Tiny inputs qualify resource and
cleanup correctness; no representative throughput improvement is claimed.

## Evidence and remaining work

**12 affected cases pass**, plus the complete cheap pre-push gate with **40/40
gate cases**. Formatting/ESLint, configuration/environment, generated freshness,
command/workflow contracts and whitespace checks pass. One job/thread,
30-second deadlines, zero retries and native-status redo disabled apply
throughout. Final observations contain no failures, timeouts, skips, native
crashes or unexpected warnings. Initial fixture-authoring failures used an
insufficient empty publication seed, then an unversioned cache path and an
incorrect binary-absence padding expectation; the fixtures now use the existing
full index, cache-path and validity/codec contracts without weakening production
validation. Those failed receipts remain historical.

The [structured receipt](cache-ownership-p1-closeout-2026-10-27.json) records the
source/tree, final observations, original-delimiter control and issue readbacks.
Raw `.tmp/tasks/p1-cache-ownership-20261027/` and `.testLogs/` receipts are
historical author-workspace evidence, absent in clean checkouts. Dependencies,
patches and Node are unchanged; earlier clean native/patch verification remains
recorded and readiness checks pass. Task children omit only the inherited
missing trusted-config selector; global/user settings are unchanged.

The live census has **723 open issues**: 462 qualification pending, 147 partial
or follow-up and 114 with unresolved implementation status. Custom backend
cleanup admission (#1574), broader lifecycle policy (#1267), full Windows and
other-platform/model/performance/release qualification remain. No Linux or WSL
execution was performed.
