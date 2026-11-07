# Serial SQLite workload profiles — 2026-10-27

Sources `2948837ceef60c5a9d2bf5662fb7870f36f5caa9` and
`5996ecd59a5bad3805696413beb9a0b20afaac65`; final tree
`f1ac0027a907c20397309708a9c63772ab06626d`, branch
`codex/pr557-audit-repairs-20261012`. Windows x64, Node 26.12.1.
Unpublished; native correctness and measured performance remain deferred.

The two existing benchmark entry points now share an actual serial campaign
owner. Smoke defaults remain 20×6 build / 12×6 update, one trial, two tokens and
one changed file. Explicit lexical/wide candidates add 128×64 / 256×128 chunks,
24/48 token occurrences, varied vocabulary/common-term TF, six independent
trials and three separately identified update rounds. Existing-file changes,
additions, deletion, shrinking and growth vary independently of repository size.
All source metadata and complete immutable bundle inventories still come from the
current admitted producer. Mutation metadata stays outside artifact manifests.

Trials alternate baseline/current order and create independent database paths.
Incremental arms start from identical build/validation settings rather than
confounding update timing with different initial preparation. Setup and external
validation are separate timings; production operation duration includes its own
checkpoint/close work and preserves the existing phase telemetry. Production
change-ratio, source/format and all-or-nothing transaction guards remain active.
A skipped update fails; it cannot silently become a rebuild measurement.

Each round checks intended mutations, exact final chunks/postings/TF/lengths,
file manifests, per-file FTS source hits and applicable filter facts outside the
timed region. Realized chunk-write counters must equal requested insertion rows.
Equivalent successful source/output identities precede paired deltas. The raw
receipt retains table/statement/batch and native checkpoint telemetry, per-round
samples, median/nearest-rank p95, mutation plans, manifest digests and source/runtime
identity. Filesystem cache conditions are explicit; no OS-cache flush is claimed.
The runtime probe now propagates inspection/close failures instead of substituting
default page/WAL observations or swallowing a failed close.

Unique run directories have atomic owner/checkpoint/final receipts. Checkpoints
identify the pending database/arm/round and expected source before actual native
operations, then identify validation separately. Failed final receipts retain
the original failure, partial counters and completed samples. Evidence retirement
is not added here; #1663 retains that separate owner. Smaller overridden workloads
are custom, and fewer than six trials cannot inherit repeated-profile eligibility.
Even completed candidates do not automatically qualify sustained performance,
retrieval latency, real corpus behavior or dense/phrase/chargram lanes.

Seven cases are authored, **unexecuted**: preset/custom admission, rejection,
alternated arm order and distribution arithmetic, immutable repeated mixed
mutations, actual build/update trial composition, and failed receipt preservation.
The six existing smoke CLI controls and production bundle/source authority checks
remain. No fixture/assertion was removed to accept a skipped or stale path.

Format/ESLint, changed-JavaScript syntax, config budget, generated script inventory
and whitespace checks passed. Shared-module analysis found zero cycles. No project
functional fixture, native SQLite experiment or benchmark campaign ran. #1733
remains open for actual baseline/current/compare execution, representative serial
trials and original/follow-up acceptance. Existing latency source-hit checks, raw
warm samples and thresholds remain unchanged and separately required. The
[performance guide](../perf/index-artifact-pipelines.md) documents scope and flags.
