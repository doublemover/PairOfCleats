# Artifact fallback failure observation

Status: UNVALIDATED source and authored controls, 2026-10-22.

The existing JSON/JSONL fallback owner now captures original resource observations
at actual caught-error boundaries. Every falsey thrown value is normalized with
its exact cause before it can be confused with the no-primary sentinel. Original
code and message diagnostics are read at most once per error and field, with
their original receiver. Inspection failures remain composed, including falsey,
frozen and independently pending secondary owners. Replacement diagnostics or
resource methods cannot replace captured original observations.

Default fallback remains limited to missing primary files. Explicit recovery
still permits ordinary settled failures, while neither mode admits another
candidate after a genuine retained descriptor or unconfirmed independent work.
A later pending candidate is never dropped just because an earlier diagnostic
has already been selected. Compressed candidate stat failures use the same
original-work guard before they can become an unknown mtime and later admission.
These are admission/reporting guards, not close, unlink or settlement authority.

Bounded contained-read failures cannot lose their actual descriptor capability
through an `ERR_FILE_TOO_LARGE` remap. A retained owner propagates before that
diagnostic transformation. Ordinary size failures after confirmed close keep the
existing `ERR_JSON_TOO_LARGE` classification and now retain their original cause
and observations. Size/decompression/parser error remapping similarly preserves
exact causes and original observations instead of reading arbitrary diagnostics
twice or dropping the cause. Native decompression protocols themselves are not
changed or qualified by this reporting work.

The existing fallback module holds only process-local diagnostic snapshots in a
weak map. It creates no resource ID, descriptor registry, namespace or cleanup
capability; actual descriptor authority remains with the existing contained-file
owner. The async small JSONL producer now passes a normalized caught failure to
its existing row queue, so caught null/undefined/false cannot become normal EOF.

The authored actual small JSON, synchronous JSONL and async buffered JSONL
controls use disposable primary/backup sources. They cover all falsey/frozen
primary failures, pending missing-shaped errors in both recovery modes,
original-observer change during a code getter, readonly single-inspection errors
with falsey/frozen/pending secondary owners, ordinary missing/recovery positives,
compressed candidate stat and later-candidate guards. An actual contained size
admission plus close fault verifies the real capability and zero backup reads,
and retains an ordinary confirmed-close size-remap positive control.

This span does not own stream destroy/close authority, raw stream-fd transfer,
compression native lifetime, queue cancellation/drain settlement, or multi-handle
row cleanup. An error report or a denied fallback does not prove those resources
closed. Existing external callback partial-emission/recovery behavior and native
IO generation limits remain separate. No tests, syntax/lint/format, bootstrap,
native, platform, full-index or performance checks have run; no completed issue or
cross-process settlement claim is made.
