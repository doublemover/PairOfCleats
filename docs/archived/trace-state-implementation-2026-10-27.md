# Shared bounded trace continuations — 2026-10-27

Source `a61b11efba3838f42520e9b0b4a4e75cbdddf732`, tree
`9a2ed2f14d49cb6ea6e901bd8617ca1bb609081e`, branch
`codex/pr557-audit-repairs-20261012`. Windows x64, Node 26.12.1.
Unpublished; functional/resource/performance qualification remains deferred.

Follow-up source `9d2986b3f2a39cb5f3a2554ae7044b1ae5715b98`, tree
`33155c37d6ef62059a646bea47f03413c4bf2ce7`, classifies seed admission refusal
through the existing `ERR_SEMANTIC_OUTPUT_LIMIT` contract. A failed reset restores
the exact previous persistent roots; invalid producer input keeps its original
cause. Two additional authored, unexecuted controls cover direct state refusal
and the actual trace service at its admitted 1024-byte limit. Total authored
continuation cases are now eleven. Static format/syntax/whitespace checks passed;
no functional qualification or publication gate ran for this follow-up.

Trace no longer structured-clones accumulated queue/seen arrays on every resume
and publication. An immutable persistent AVL tree preserves context-sensitive
visited membership, while a persistent two-list FIFO shares pending refs/contexts
and removes processed items from newer frontiers. Newly admitted ref/context
items are validated, independently sized, copied once and frozen. AVL path copies
and occasional frontier-link reversal remain explicit counters. Snapshots and
resume share roots in constant metadata work.

The internal state bound is 8 MiB of conservative logical bytes plus the retained
16,384-visit ceiling. Ref/context payload size cannot hide behind a short key.
Admission precedes item cloning; refused visits report the existing visited-budget
frontier and partial status. Saved snapshots default to 32 MiB per service and
64 MiB per trace/explain runner across repository/policy services. Full logical
snapshots are charged even when physical nodes/strings are shared. This is not
measured V8/RSS accounting or an aggregate active-request memory guarantee.

Reading a cursor does not consume it. Concurrent/repeated earlier-cursor use has
independent mutable facades while its snapshot remains retained. Byte/count/TTL
eviction removes the original cursor and accounting lease together; service-cache
retirement releases its snapshots. An evicted in-flight service cannot return a
new unusable cursor. Request/generation/inventory/backend/query identities remain,
with internal policy identity v3 including the state allowance.

Work timing starts before service request capture, validation, hashing and resume.
Reader cleanup/final response projection still precede publication. Preparing a
failed/cancelled page installs no lease or new cursor. Aggregate capacity is checked
before local eviction. Retained callbacks are created in a factory scope without
hydrated response/query-store page locals. Saved state contains compact refs,
contexts, stage/offset and coverage flags. Trace/explain wrappers and both runner
caches adopt the owner. No public config/CLI field, response schema or semantic
artifact-format relaxation is added.

Nine controls are authored, **unexecuted**: ascending AVL/FIFO order and direct
clone instrumentation over 1,000 admissions/100 forks, replay isolation, state
admission, byte/TTL retention, actual 40-node ordered traversal, concurrent cursor
replay, multi-service eviction, failed final projection and partial budget frontiers.
Existing API, trace/explain parity, evidence traversal and reader/publication
negatives remain. Serial CPU/heap measurements still need raw samples; no general
speed/RSS gain is inferred from source counts.

Format/ESLint, changed-JavaScript syntax, config budget, script inventory and
whitespace checks passed. Shared-module analysis found zero cycles. No project
functional fixture, trace runtime experiment or benchmark ran. #1581 remains open
for original/follow-up correctness, cleanup, multi-service and measured acceptance.
See the [continuation contract](../contracts/semantic-trace-continuations.md).
