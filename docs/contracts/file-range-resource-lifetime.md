# Bounded synchronous range descriptor lifetime

Status: source and authored regressions are **UNVALIDATED**. No executable
validation or native filesystem qualification has run.

`readFileRangeSync` borrows its descriptor through the existing contained-file
resource owner. The contained branch uses `withContainedFileSync` without a raw
descriptor transfer; the ordinary branch captures the original fs receiver and
read/stat/close methods before opening its actual descriptor. Both execute the
same bounded positioned-read callback. Original methods remain authoritative
across callback replacement, including descriptor zero.

Finite range normalization, positive short-read completion, EOF prefix returns
and invalid-progress rejection retain their existing behavior. Empty ranges
open nothing. Bytes are returned only after confirmed standard void close. A
read rejection and independent close rejection preserve both original failures,
including falsey and frozen values; close cannot replace the original read.
Independent original read observations gate actual close even when their marker
is absent or false, and replacing the observer cannot authorize destruction.

An actual failed descriptor lifetime exposes the existing privately validated
contained-file session. If an original pending read prevented any close attempt,
that exact synchronous capability may perform its first close once the original
observation confirms. It never rereads the range or publishes the earlier bytes.
After an attempted synchronous close throws or returns a nonvoid result, fd
generation is unknown. The session cannot retry numeric close, even after path,
inode or fd checks, method replacement, external disposal, or OS numeric reuse.
No settlement receipt is fabricated for that permanent unknown state.

`tests/shared/files/read-file-range-resource-lifetime.test.js` authors actual
raw and contained range consumers with short reads, EOF and normalization,
original method/receiver capture, read-native prerequisites, all nonvoid close
results, falsey/frozen read plus close failure, numeric-generation refusal and
invalid read progress. Existing fd-zero and positive short-read fixtures remain
unchanged. Disposable descriptor cleanup is not resource-settlement evidence.

This does not adopt the other catch-to-fallback JSON helpers in `file-read.js`,
the opaque lock-info borrower, stream owners or atomic publication. It adds no
new resource registry, coordinator/category lease, cross-process authority or
issue-completion claim. The existing contained-path checks and ordinary raw
path semantics remain distinct and unchanged.
