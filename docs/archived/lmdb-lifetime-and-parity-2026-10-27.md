# LMDB native lifetime and artifact parity — 2026-10-27

Source `40f3bc7854f9a9575a52fda1524083a132d89283`, tree `b095e9a6396eca442b89c76707f609b9aae12c95`;
native lifetime repair `fff95d513ae4e0d83d8b1d27512d39d6f9358e4e`.
Windows x64, Node 26.12.1, LMDB 3.5.1. [Structured receipt](lmdb-lifetime-and-parity-2026-10-27.json).

## Delivered behavior

LMDB can return a resolved close promise while its prefetch counter still owns
outstanding work. Its completion callback runs after that work drains and the
library closes the environment. Retrieval and the existing canonical build owner
now await both the captured close result and callback. A rejected/false result
retains uncertainty even if a callback arrives later. No dependency patch, pin,
new backend, retry or timeout workaround was used.

Retrieval captures its original close before schema operations; replacing the
method afterward cannot replace that owner. Initialization, backend-context and
tracking failures retain their exact primary cause plus native cleanup failure.
The existing awaited/idempotent disposer captures resource observations before
independent cleanup can replace report callbacks, preserves failed outcomes and
still closes healthy sibling handles. Cleanup cannot infer native success from
an aggregate error losing its pending observation.

Native artifact acceptance now covers the actual builder, store readback and
memory/native consumers for manifest-selected JSON, sharded JSONL and columnar
file_meta/field_tokens. Stale flat aliases cannot replace selected data. Corrupt
either selected family and the builder fails before replacing its prior valid
native payload. Chunks already carrying file/ext still hydrate author,
modification, external-document and churn fields. The memory reader's explicit
zero-churn overwrite was also repaired: both consumers now preserve zero.

## Proof and coverage

Selected original owner modules from `6fc542632` were loaded through a child-only
Node hook; the checkout was never reverted. Both actual native prefetch controls
fail before the repair because their owners report success while the native
callback is held. The metadata control also fails before repair: memory reports
churn 9 where native LMDB correctly retains 0. All pass after repair.

**21/21 affected fixtures pass**, including two native-prefetch controls, four
actual native failure-propagation cases, three native format cases, existing
selected-generation/optional-array/replacement controls, hydration contracts,
backend lifecycle, canonical native-command ownership and four uncached SQLite
controls. One job/thread, 30-second fixture deadlines, zero retries/native-status
redo; zero failures, timeouts or skips. Format and every cheap front-gate command
pass, including **40/40 gate cases**. Generated config inventories were refreshed
through the existing owner; no public config keys, CLI or artifact formats changed.
No semantic producer meaning changed.

The previous lifecycle fixture replaced close after acquisition to model delay.
It now checks that the captured method remains authoritative; actual asynchronous
coverage moved to the stronger native prefetch barriers for both owners. The
inert LMDB-shaped registry control now supplies the real callback contract and
keeps its wait/failure assertions. No meaningful lifecycle coverage was removed.
Initial harness failures (Windows import URL, non-enumerable native bindings and
a prohibited repository config field) were corrected and retained separately;
they are not counted as product failures or passing evidence.

**#1084 and #1093 are closed, with source-bound read-back verification. #1574 stays
open:** custom-root registration, launch authority, remaining native/cache/sidecar
sessions and category/multi-repo cleanup qualification remain. External roots
stay protected. This fixes a demonstrated premature-settlement defect without
claiming attribution of historical access violations or complete crash closure.

Raw receipts under `.tmp/tasks/lmdb-owner-closeout-20261027/` and `.testLogs/`
are historical author-workspace files, absent from clean checkouts. Dependencies
and patches were unchanged; this batch did not rerun bootstrap. Non-Windows,
performance, optional-backend, full-suite, hosted-CI and release qualifications
remain separate. No editor, WSL, elevated process or physical symlink was created.
