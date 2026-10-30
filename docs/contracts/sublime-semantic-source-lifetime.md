# Sublime semantic source opening lifetime

Exact source opening from a semantic record retains the original semantic
operation scope and selected window through the existing result opener. A newer
semantic command or changed repository context revokes the old opening before
file dispatch and before deferred target selection, reveal or annotations.
Replacing the caller's context or scope cannot transfer the old opening to the
new command. Opening the intended target may change focus without revoking the
original semantic operation.

The original repository, source path and byte hash, record reference and UTF-16
span are captured before source-file observation. A later mutation of those
caller dictionaries cannot rewrite the selected source or range. Existing
contained-path, byte, UTF-16 boundary, opened-filename and buffer checks continue
to apply. File observations do not provide an atomic filesystem snapshot.

The internal opener also accepts an optional original parent predicate, forwarded
through the same deferred opening checks. It requires an explicit `True`, checks
the semantic scope again after the predicate returns, and latches any observed
revocation or thrown observation. A thrown observation preserves its original
exception. Replacing state or later returning `True` cannot reacquire authority.
Legacy direct helper callers without a semantic scope retain their existing
source-qualified opening behavior. An explicitly supplied invalid scope cannot
use that compatibility path.

Ambiguous indexed navigation checks the original cursor before accepting a
candidate and passes its original navigation scope and source predicate through
the same deferred opening. After that admission the requesting view, buffer,
version and saved bytes must remain current; intentionally opening the target
does not require the previous focus or cursor. A new navigation request, edited
or renamed original view, or changed original source bytes revokes delayed target
selection. Candidate inspection remains ambiguous and does not pool references.

The actual semantic record/action picker, deferred result opener, original file
observation and callback controls are authored and **UNVALIDATED**. No tests,
Python/Node, syntax/lint/format, bootstrap, editor/native/child/IPC/browser/GPU,
model, build or benchmark execution was run. Real editor effects, cancellation,
native teardown and resource/performance acceptance remain separate.
