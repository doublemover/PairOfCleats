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

The native error exists before forensic publication or warning work. Required
forensic IO failure and independent pending observations remain secondary causes;
they cannot replace the original native failure or trigger another child run.
Failed publication invalidates only its matching in-memory dedup candidate and
preserves already-written evidence. This does not qualify concurrent forensic
index publication or make its multi-file record crash-atomic.

Fixture child runners require the explicit test environment and are absent from
CLI/config. Simulated exit codes do not qualify a native dump collector. SQLite
is a required verified package, so the real isolate fixture fails on missing
native setup instead of silently skipping. All original vector/replay assertions
remain. Twenty-seven new controls and the affected original fixture are unrun.

Forty-six additional format/collector controls are authored and unexecuted.
The collector controls use synthetic minidumps and an explicit trusted fixture
runner; none launches CDB or proves an access-violation cause. Actual child wrapper,
CDB/minidump/termination/symbol and original replay acceptance remain. Replay
references are not an immutable self-contained archive of the crashing generation.
Microsoft documents [child-process debugger ownership](https://learn.microsoft.com/en-us/windows-hardware/drivers/debugger/cdb-command-line-options),
[second-chance filters](https://learn.microsoft.com/en-us/windows-hardware/drivers/debuggercmds/sx--sxd--sxe--sxi--sxn--sxr--sx---set-exceptions-)
and [minidump creation](https://learn.microsoft.com/en-us/windows-hardware/drivers/debuggercmds/-dump--create-dump-file-).
The default `/m` content includes modules, threads and stacks; `/ma` also includes
full memory. No debugger registration, global security setting, installation or
native/debugger execution occurred in this implementation batch.
