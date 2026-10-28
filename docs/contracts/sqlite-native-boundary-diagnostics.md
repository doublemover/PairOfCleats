# SQLite native boundary diagnostics

The isolated stage3 worker retains numeric native exit classification, original
stderr/stdout, mode/build/worker identity and replay inputs. Success requires a
numeric zero exit, no signal, complete nonempty JSON and an object result. Null,
string, truncated or malformed protocol evidence cannot become success. Unknown
child ownership precedes projection and remains required through later logging.

Replay diagnostics are version **1.1.0**. Missing numeric metadata stays null.
Non-string output is marked unavailable without coercing arbitrary objects.
`crashCapture` distinguishes disabled, unsupported-platform and unavailable;
requested capture is **not enabled** without a configured scoped native collector.
An unconfigured request creates no placeholder directory and scans no unrelated
dump tree. The explicit internal `createWindowsCdbCollector` capability can be
passed as `windowsCrashCollector` to the SQLite boundary or programmatic Stage3
entry point. JSON/config objects cannot manufacture that producer identity. The
collector's IO implementation loads only when that capability is used.

The collector launches an explicitly selected existing x64 CDB with child
debugging, an owned command file, hidden-window/shared process ownership and a
deadline of at most 30 seconds. It never registers a debugger, installs anything,
opens a terminal, changes Windows policy or retries a child. Read-only runtime
aliases resolve to physical executables before hashing and launch; this supports
nvm4w without creating links. Runtime/native inputs are hashed before and after
the session. Explicit local symbol directories are optional; CodeView GUID/age
and PDB names are recorded, **matching symbols remain unqualified**.

Second-chance exception commands request context, all-thread stacks, modules and
a normal `/m` minidump. CDB's own zero exit is never the application status. An
ordinary exit reply binds the launch nonce/PID, output extents and numeric exit;
a crash requires an owned regular minidump with matching target PID, bounded
stream extents, exception/context, recorded exception thread and module records.
Duplicate/malformed/foreign dumps and full-memory dumps fail. A simulated native
exit without an exception dump reports `no-dump`, not capture success.

Evidence uses unique owned attempts: 16 MiB maximum dump, 24 MiB declared attempt
allocation and 128 MiB family admission. Each output stream retains at most 1 MiB.
Growth sampling aborts excessive/unexpected writes. These are cooperative and
sampled bounds, **not an OS disk quota**. Existing evidence is never evicted or
claimed by directory enumeration. Environment values are recorded only as hashes.
Failed or pending original work keeps its reservation; explicit producer-owned
metadata reconciliation checks the original observations and never relaunches
CDB or application work. Evidence remains for review.

Results distinguish `captured`, `no-dump` and `failed`, with explicit
`fixture-controlled` versus `real-debugger` execution. A valid target exception
survives subsequent integrity, evidence-publication and metadata failures; those
remain secondary to the native error. A failed collector cannot acknowledge a
successful SQLite result. Setup/runtime activation is separate from native
lifecycle and crash qualification.

The actual synchronous dense updater now distinguishes genuine absent catalog rows
from failed/invalid schema queries. A selected column's native type or bounded,
anchored producer DDL owns its width; another column/default string cannot justify
a destructive ANN rebuild. Unknown width fails before DROP. Required synchronous
pragma failure propagates. These checks retain original query observations.

Dense update and the legacy row-materialization helper compose the existing
constructor-time SQLite close owner and original contained-source close owner.
Unsettled work blocks rollback/cleanup; independent settled cleanup attempts run
even after another close fails. Falsey work and independent close errors remain.
The private cleanup capability reconciles existing original resources, never vector
reconciliation or rollback. This is synchronous resource ownership, not complete
custom-root writer registration or a new public configuration surface.

The real wrapper also appends at most 64 small owned progress events. Events bind
nonce/PID/sequence and a closed phase set around initialization, native import and
SQLite update. Complete lines survive a partial final write; foreign identity or
invalid committed events fail collection. Missing/partial progress cannot claim
complete diagnostics. These are completed JavaScript checkpoints, **not a native
fault attribution**. Import and progress-write failures retain their actual owner
instead of misreporting a successful import as dependency absence.

The native error exists before forensic publication or warning work. Required
forensic IO failure and independent pending observations remain secondary causes;
they cannot replace the original native failure or trigger another child run.
One logger now serializes forensic payload/index publication on the shared queue.
It snapshots accepted JSON before asynchronous work, keys dedup by kind/signature,
and exposes a cached path only after full publication. Matching in-flight callers
join the original outcome; optional callers cannot downgrade a required caller.
Settled failed required publication remains a flush failure until an explicit
successful publication for that key. No native/application work is retried.

Flush drains accepted caller outcomes, including diagnostics, before append
barriers. Close stops forensic intake, drains accepted work and independently
attempts all four append closes even after a failure. Original pending results,
errors, warning resources and late revocation remain required. Admission limits
retained serialized payloads to 2 MiB each, 8 MiB pending, 32 MiB accepted per
logger, 32 simultaneous callers and 512 write attempts. These are payload/work
limits, not pre-serialization peak memory or OS disk quotas. Already-written
evidence remains. Multi-file crash atomicity, concurrent separate logger owners
of one explicit attempt, and generation-qualified immutable replay remain separate.

Fixture child runners require the explicit test environment and are absent from
CLI/config. Simulated exit codes do not qualify a native dump collector. SQLite
is a required verified package, so the real isolate fixture fails on missing
native setup instead of silently skipping. All original vector/replay assertions
remain. Twenty-seven new controls and the affected original fixture are unrun.

Forty-six additional format/collector controls are authored and unexecuted.
The collector controls use synthetic minidumps and an explicit trusted fixture
runner; none launches CDB or proves an access-violation cause. Actual child wrapper,
CDB/minidump/termination/symbol and original replay acceptance remain. Eighteen
more real atomic-IO concurrency/drain controls are authored and unexecuted.
Six real ordinary-child wrapper controls and three fixture-controlled progress
controls are also authored, unexecuted; no debugger or access violation is simulated
as passing native qualification. Replay references are not an immutable
self-contained archive of the crashing generation.
Thirty-three schema/lifetime controls, including eight actual SQLite paths, are
also authored and unexecuted. The user's current boundary is checkpoint 240:
finish that implementation batch, then run full Windows-applicable validation.
Microsoft documents [child-process debugger ownership](https://learn.microsoft.com/en-us/windows-hardware/drivers/debugger/cdb-command-line-options),
[second-chance filters](https://learn.microsoft.com/en-us/windows-hardware/drivers/debuggercmds/sx--sxd--sxe--sxi--sxn--sxr--sx---set-exceptions-)
and [minidump creation](https://learn.microsoft.com/en-us/windows-hardware/drivers/debuggercmds/-dump--create-dump-file-).
The default `/m` content includes modules, threads and stacks; `/ma` also includes
full memory. No debugger registration, global security setting, installation or
native/debugger execution occurred in this implementation batch.
