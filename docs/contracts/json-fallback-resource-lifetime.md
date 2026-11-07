# JSON fallback descriptor lifetime

Status: source and authored regressions are **UNVALIDATED**. No executable
validation, formatter, bootstrap or native/platform qualification has run.

`readJsonFileSafe`, `readJsonFileSyncSafe` and `readJsonLinesSyncSafe` borrow actual
descriptors through the existing contained-file resource owner. They capture
original native methods and receiver; synchronous methods are captured before
open. The internal JSON borrower admits a bounded regular file, completes its
stat-sized positioned read in windows of at most 64 KiB, and checks the same
descriptor's identity/size/timestamps afterward. Text conversion and JSON parsing
follow confirmed standard void native close. There is no raw descriptor transfer.

The optional `maxBytes` path-stat precheck retains its existing `stat` reporting
phase. The actual opened descriptor also checks that bound before allocating or
reading; stale path stats cannot bypass it. That second denial reports `read`,
the actual phase. There is no new public configuration knob. Missing files,
ordinary completed read/parse errors, legacy fallback arguments, null/symbol
fallback identity, malformed JSONL line skipping and valid falsey JSONL rows
retain their fallback behavior. Nonregular or changed inputs are ordinary safe
read failures, rather than partially read JSON values.

Fallback is conditional on original native settlement. A failed close, pending
read/stat, unreadable observer or other unknown original resource propagates its
existing retained error and actual descriptor capability. An absent or false
marker does not cancel an original observer. Report callbacks cannot replace
that original function or authorize fallback. An error-report callback's own
unknown native failure composes with the primary; ordinary completed callback
errors retain the legacy ignored-report behavior. Captured report fields preserve
the original input path, raw error, phase and sync flag.

This distinction matters to existing bounded-cache borrowers: an unknown native
read/close cannot become `fallback` data and be treated as an invalid cache file
eligible for removal. The safe helper itself grants no deletion or cache/category
authority. Other callers that independently catch every propagated failure still
need their own lifetime integration.

Actual async failed FileHandle close is reconciled only through its existing
original capability, without rereading, parsing, invoking the report callback or
returning the earlier value. If pending work prevented the first synchronous
close, that capability may close once it confirms. After an actual synchronous
close fails/nonvoid result, numeric generation stays unknown; external disposal
or fd reuse cannot manufacture a receipt or permit another numeric close.

`tests/shared/files/json-fallback-resource-lifetime.test.js` authors actual JSON,
JSONL and bounded-cache consumers for failed close, native read guards,
nonvoid sync close, exact child recovery, pending stat/report errors, stale
precheck denial, positive short reads and ordinary fallback/falsey row controls.
The existing `read-json-safe-on-error` fixture now uses disposable malformed real
files instead of obsolete `readFile` monkeypatches. Its one parse report, original
path/phase/sync metadata, sentinel fallback and explicit-null assertions remain.
The existing JSONL falsey fixture remains unchanged.

This does not adopt `pathExists` or all other raw JSON/stream/atomic-write readers,
nor does it settle async work returned instead of thrown by a synchronous report
callback. It introduces no resource registry, coordinator, path mutation or
cross-process authority. Regular-file byte allocation retains the existing Buffer
ceiling and configured smaller bound; performance/native acceptance and issue
completion remain open.
