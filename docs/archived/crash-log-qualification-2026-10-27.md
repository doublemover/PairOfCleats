# Crash-log Windows qualification — 2026-10-27

Production repairs start at `c5ebd6e6420a88abecbb3b3783a383a0ee90029d`;
final qualified source is `afc52ef9d31f9afdf4b89947a21e8fe930c6a944`, tree
`40d311ee6cadf959754537d609cacb556c2efb3a`, on
`codex/pr557-audit-repairs-20261012`; Windows x64, Node 26.12.1.
[Machine-readable receipt](crash-log-qualification-2026-10-27.json).

## Changes and demonstrated behavior

The existing append/terminal owner now has Windows qualification for native
append-file identity, asynchronous state replacement, and concurrent child
writers. Five added boundary cases cover error before append-open completion,
error during a real held append and close, accumulated logs, terminal disk
failure and convenience-pointer failure. Close waits for the original operation;
later phases cannot erase terminal severity, and repeated/late errors retain
separate immutable evidence. No append target is replaced or read back during
error handling. The large-log controls seed two 2 MiB append files, guard against
whole-log reads/replacement, and verify terminal size stays within the existing
128 KiB reader allowance. These are resource/correctness bounds, not a latency
benchmark or a claim about every diagnostic input's memory use.

An additional real Windows control uses the existing headless metadata-holder
helper to deny replacement of an attempt's latest terminal pointer. The native
`EPERM` is retained, the original pointer bytes remain unchanged, and the second
immutable record stays confirmed. After the exact helper releases its file and
exits, a new terminal event publishes successfully. This explicit native owner is
`tests/fixtures/indexing/crash-log-windows-sharing.js`; it changes no ACLs and
needs no elevated launch. It is separate from portable test discovery.

The first new controls exposed plaintext `token=...` in crash messages. The
shared redactor now handles that assignment and preserves public URL query
parameters in one pass. Structured crash events also mask an exact `token` field
while retaining token counts and tokenizer identity. Tests preserve surrounding
diagnostics, Unicode boundaries, caller immutability and existing credential
forms. They cover real error publication and direct structured evidence.

Compact shared diagnostic graphs also now consume one shared node and encoded
byte allowance across recursion. The regression observes **4,096** shared-leaf
inspections before the fix and **236** afterward. A bounded fallback preserves
the captured primary message/code without inspecting changing getters again;
the getter regression records exactly one original message read. Inert object
fields cannot invoke coercion during fallback. Per-container limits, redaction
and the existing output allowance remain. The traversal budget bounds projection
work; it is not a bound on execution inside arbitrary caller-defined getters or
native own-key enumeration.

Crash evidence now retains an atomic failure's underlying `causeCode` alongside
its existing wrapper code. Controlled `ENOSPC` is explicit for both failed
terminal publication and a failed latest pointer. A pointer failure leaves the
immutable record confirmed; a terminal write failure reports `written: false`
separately from the unchanged original error. No global atomic-write behavior,
fsync, authority, public knob, retry, deadline or retention threshold changed.

## Checks and remaining work

**20 affected fixtures pass together against the final source**, plus the
separate real Windows sharing control. The event fixture was rechecked after its
observation output changed. **40 gate cases** and all other cheap pre-push checks
pass against that source. No fixture exceeded 30 seconds; retries were zero and
native-status redo was disabled. Existing sink negatives assert their expected
warnings; the new controls assert no unexpected warnings. Native editor UI was
not launched for this batch.

The initial controls are preserved: three failed on the token disclosure; the
initial disk test expected a native code where the existing atomic contract
returns a wrapper. That assertion was corrected to require the wrapper plus the
new underlying cause. A subsequent URL-preservation assertion caught the first
redactor revision consuming public query parameters; the final one-pass repair
passes that original assertion. No positive or negative assertion was removed.

**#1315 remains open** for POSIX execution and measured error-path latency;
Windows-only scope is preserved. The real Windows sharing refusal and controlled
disk/rename failures are qualified here. These checks
qualify diagnostic persistence; native access-violation attribution retains its
separate owner and receipts.

## Format-cutover gate follow-up

The intermediate gate failed one format-cutover case with a semantic integrity
error instead of its original unsupported-format rejection. A stat-keyed parsed
pieces memo can retain an old registration during same-length rewrites. Semantic
opening now obtains fresh contained registration bytes through the shared
manifest owner before snapshotting metadata and awaiting payload reads. It does
not read or republish the ordinary parsed memo for authority. Ordinary cache
reuse and its profile limits remain covered; each semantic open now pays one
fresh pieces-manifest read. The public command/configuration and semantic
producer formats are unchanged.

Two deterministic controls publish a held older parse through the actual memo
owner after a same-length rewrite, without altering descriptor/path stat checks.
A valid generation B opens with B's identity; unsupported B retains its original
format rejection. Existing metadata snapshot and native SQLite consumer controls
also pass. The combined final run contains **26 fixtures**: the 20 crash/redaction
checks plus six semantic/cache/format checks. The final front gate is 40/40.
The earlier 39/40 gate failure remains historical evidence, not a passing run.

**#1547 remains open** for remaining path/link authority acceptance. Its physical
link-creating runtime fixture was not launched under the current no-new-symlink
scope. A headless native SQLite run and controlled mutation/cancellation evidence
do not silently discharge that separate requirement. No editor UI was launched.

Historical author-workspace reports live under
`.tmp/tasks/crash-log-qualification-20261027/` and their referenced `.testLogs/`
directories. Fixture caches are disposable. These paths are absent from clean
checkouts; the committed receipt retains exact commands and case identities.
