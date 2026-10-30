# Bounded removal result and native prerequisites

Status: UNVALIDATED source and authored controls. No runtime, cross-process,
native-lock, physical-link, import-budget or performance checks were executed.

The existing removal helper still returns `{ok, attempts, error}` and retains its
retryable code set and delay bounds. It now counts actual admitted remove calls.
An initial observed absence needs zero removal attempts. This helper accepts only
a path already authorized by its caller; it creates no category, lease, manifest
or cleanup authority.

The default native path is resolved once and its original lstat method is captured
before awaiting removal. BigInt root and immediate-parent identities are admitted
before the first native call, then compared before later attempts and after native
completion. A changed parent cannot turn a missing child into success while its
original parent still contains the old object. A foreign replacement root is not
removed by another retry. Root comparison excludes mutable tree counters and does
not seal every descendant.

Every removal/probe rejection captures its original resource observer before code
inspection. Original prerequisites gate retry, existence checks and success. A
false/absent marker or replacement observer cannot turn pending native work into
an absence receipt. Nonvoid removal results and nonboolean synchronous existence
adapters remain unknown. Failed or unreadable probes are never interpreted as
missing paths. An ordinary nonretryable rejection remains failure even if a later
path check could report absence.

Failure results preserve raw falsey/frozen causes, independent probe/inspection
failures and actual existing contained-file capabilities. Exact close-only
recovery can settle that descriptor; it cannot retry deletion or change a
historical failed removal result. Phase/path/attempt context supplements the
original native primary rather than replacing its code with a later diagnostic.

Existing injected `exists` adapters keep their synchronous boolean contract.
They provide no native identity witness: their caller owns the adapter's scope
and comparison guarantees. Async adapters are not silently awaited or accepted
as false; rejection observation alone grants no settlement authority. Existing
ordinary virtual retry fixtures remain meaningful under that explicit contract.

The new authored fixture exercises actual file/directory removal, native root and
parent replacement, captured method replacement, raw failures, failed probes,
pending observer projection, the real bundle `removeFileOrThrow` consumer and
actual descriptor capability forwarding. It has not been run. The final
comparison/syscall race, mutable children, external coordination and callers that
discard failure results remain separate limits; no portable atomic compare/unlink
or arbitrary native resource settlement is claimed.
