# Binary frame iterator resource lifetime

Status: UNVALIDATED source and authored controls, 2026-10-22.

The binary-columnar frame generator borrows the existing contained-file resource
owner across synchronous yields in both strict and legacy path modes. Sidecar
resolution remains eager, while the data descriptor opens only on first `next()`.
An unstarted `return()` or `throw()` opens no data descriptor. Rows remain one
bounded frame at a time; no full-payload materialization, fallback or replay is
introduced. Existing safe offset, row extent and byte-budget checks remain, and
read progress must be a positive safe integer within its requested window.

The exact original read/stat/close methods and receiver remain captured across
yields. Normal exhaustion, explicit return, early break and unhandled throw use
the same owner to close. Original read/stat/parse failures, falsey thrown values
and independent close failures remain composed. Original independent native
observations gate actual descriptor destruction; replacing a method or clearing
a marker does not authorize it. Final file stamps must remain stable, and strict
mode rechecks descriptor containment before close.

`iterateContainedFileResourceSync` and the contained-path adapter do not pass a
generator object through `runSync` as if its work were complete. They acquire
lazily and delegate to the same resource owner's synchronous iterator lifetime.
The existing private resource map also recognizes the actual borrowed iterator
after its borrowed lifetime ends, so a direct borrower holding it can retrieve
its exact session with
`getContainedFileSession(iterator)`. A copied ID, marker, cause chain or synthetic
iterator confers no authority. A live suspended borrower does not expose this
close-only recovery capability. There is no second registry or filesystem lease
namespace. Failed admission still exposes its capability through the actual
failure even when acquisition cannot return a borrowed iterator.

The actual JSON row decoder forwards parse failures and `throw(error)` at its
suspended yield into the payload owner before close. The multi-part and public
async row wrappers delegate return/throw rather than implicitly converting every
abrupt completion into a plain `return()`. Parse error wrapping retains exact
falsey/frozen causes and original native observations while preserving the
public `ERR_ARTIFACT_CORRUPT` classification. Later parts and rows are not started
after failure, early break or return.

A sequential verification witness hashes frames, padding and trailing bytes on
the same opened descriptor. Its new `prepare()` step verifies and finalizes the
certificate while the descriptor remains live; publication waits for normal
exhaustion and confirmed close. Early termination, close failure and close-only
recovery cannot publish it. Existing `finish()` consumers retain their immediate
publication behavior and are not claimed to have adopted this iterator lifetime.
The standalone checksum read remains a separate prior pass; it must close before
the decode descriptor opens. This does not claim that two separate opens prove
one physical generation or provide an index/category lease.

The existing synchronous recovery limit remains strict: original work that
blocked the first close can permit that first captured close once confirmed;
an attempted close that throws or returns a nonvoid value leaves the numeric fd
generation unknown and cannot be retried. Recovery never resumes the generator,
reparses a row, rereads bytes or publishes a prepared witness. External teardown
does not manufacture a settlement receipt.

JavaScript's external `for-of`/`for-await-of` body-throw protocol calls the
iterator's `return()` without passing that thrown value, and may preserve that
body error over a failing close. An iterator cannot observe that hidden error or
infer unrelated native settlement from it. Direct callers needing original-work
gating must forward an actual `throw(error)` and retain the returned failure or
the actual borrowed iterator capability. Ordinary body throw with successful
close and early break with failing close are covered; arbitrary external native
work and suppressed cleanup diagnostics at that language boundary remain an
explicit limit. A suspended iterator must be exhausted, returned or thrown into;
abandoning its reference does not run cleanup or prove close. No cross-process,
garbage-collection settlement or descendant census is added.

Authored controls use actual disposable frame fds, canonical public artifact
families, checksums and both path modes. They cover lazy open, method replacement
across yields, bounded short reads including trailing-byte hashing, zero-length
frames, return/break/throw, falsey and frozen errors, close failure after the last
yield, invalid progress, final stamp change, witness suppression, parse-plus-close
composition and public observer replacement before explicit first-close recovery.
Existing no-full-materialization and frame/budget regressions remain. No tests,
syntax/lint/format, bootstrap, native, platform, performance or full-index checks
have run; no executable acceptance or completed-issue claim is made.
