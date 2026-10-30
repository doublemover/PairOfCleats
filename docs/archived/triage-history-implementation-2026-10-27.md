# Exact triage decision lineage and bounded precedents — 2026-10-27

**Unvalidated source:** `a97ec9600a6707e8b0620562842a797e75a10ea4`, tree
`a9c78035e7408edef6aca7fa5ac5f779a2aa89df`, branch
`codex/pr557-audit-repairs-20261012`. Windows x64, Node 26.12.1.
Local implementation checkpoint; not pushed or functionally qualified.

#1699's route-first affinity could omit an exact decision after its finding's
route changed. Context packs now keep the original history records and add a
strict version-one selection envelope. Half the bounded initial allocation,
rounded up, is reserved for exact finding links. Related precedents retain the
existing affinity weights/route priority and are explicitly labeled. Matching
vulnerabilities, packages and common manifest basenames confer no exact identity.
Conflicting repository/observation identity disqualifies an exact link.

Rows retain source decision/finding IDs, matched fields and scores, route drift,
available original/current observation hashes, expiry and future timestamps at
an explicit as-of time. Missing legacy observations remain unknown. Authored
statuses/reviewers are not collapsed into a current verdict or automatic approval,
suppression or mutation authority. Supersession remains unverified.

The legacy affinity helper and new selector share one actual snapshot/queue owner.
Its four-read admission, individual 16 MiB read limit, bounded redacted failures
and zero retries remain. Pending successful replies now join the same original
observation requirement as thrown failures. Legacy route/rank/tie positive and
failure assertions remain; the real-file control now supplies the canonical
record kind/source required by its existing authoritative reader.

Selection has at most 256 outputs, 1 MiB compact history-plus-envelope bytes and
three bounded candidate lanes totaling at most 3 MiB charged wire/item bytes,
plus one transient insertion and admitted reads. Names, queue metadata and compact
content digests remain O(N); full corpus bodies are not retained. Disabled history
does not scan. Known omitted/oversized counts remain distinct from lower bounds
after read failure. These are data/work bounds, not heap or latency measurements.

The bounded exact-history cursor captures policy, finding content/observation,
selected repository/record namespace, as-of time, budget, observed public-record
content/name digest and an actual exact boundary. One fresh four-read scan per
continuation refuses drift, incomplete observation or an unknown boundary. It
does not authorize paths, claim a filesystem transaction or page related history.
The explicit `--history-after <json>` CLI input is limited to 32 KiB, strictly
validated and captured before awaits. The guide documents the new surface,
default allocation, limitations and a PowerShell continuation recipe.

New decision Markdown uses renderer 2 to identify the original finding and its
historical interpretation. Readers verify earlier renderer-1 immutable generations
with that exact renderer. A same-record reimport can publish renderer 2 while
retaining earlier evidence; receipt path/hash/size/version negatives remain strict.
The shared records producer advances to 11. The
[selection contract](../contracts/triage-history-selection.md) owns the complete
schemas, budgets, ranking, cursor and historical interpretation.

Fifteen **unexecuted** `tooling/triage/history-lineage/*` cases cover route drift,
similarity/repository/source negatives, conflicting/expired/future decisions,
byte/count/actual-heap admission and four-read limits, disabled history, ordinary
and pending read failures, pending successful replies, deterministic continuation,
stale scope/content/boundary, cursor typing/capture, actual persisted publication
and reconstructed valid renderer-1 compatibility. The existing actual
ingest/decision/index/context CLI fixture also asserts the exact finding link and
typed selection envelope. No meaningful legacy coverage was removed.

Static format/ESLint, changed JavaScript syntax, strict compilation of both new
JSON schemas, config budget, command inventory generation and whitespace checks
pass. Shared-module analysis finds zero cycles. Generated configuration inventory
was refreshed. No functional fixture, CLI/child, index, model, benchmark or
publication front gate ran. Actual original/new history, context, record
publication/decision/ingest and consumer/replay acceptance remains; #1699 and
#821 remain open pending their complete required qualification.

## Directory observation follow-up

Unvalidated source `2d2da584aa11c2ddb7a64b6f862ff8d36a65b352`, tree
`7b103db3a9623a4c7532ea6aa0bb62cf1077031f`, also captures successful directory
ownership before projecting names. Fixed name DTOs cannot change across awaits
or select another path. Original directory/record observers remain required
before further native reads, after callbacks and at return; independent callback
failures retain both prerequisites. Two additional unexecuted cases cover a
pending successful directory and an observer changing during an actual admitted
read, bringing the suite to **17 authored cases**. Format/ESLint, changed syntax
and whitespace checks pass; no functional execution or new qualification occurred.
