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
The current boundary has no admitted collector, creates no placeholder dump
directory, scans no unrelated dump tree and reports no owned dump files.

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

Remaining #248 work is a scoped real Windows collector and actual dump/context/
stack/module validation with bounded original lifecycle and replay acceptance.
Microsoft documents [child-process debugger ownership](https://learn.microsoft.com/en-us/windows-hardware/drivers/debugger/cdb-command-line-options),
[second-chance filters](https://learn.microsoft.com/en-us/windows-hardware/drivers/debuggercmds/sx--sxd--sxe--sxi--sxn--sxr--sx---set-exceptions-)
and [minidump creation](https://learn.microsoft.com/en-us/windows-hardware/drivers/debuggercmds/-dump--create-dump-file-).
The default `/m` content includes modules, threads and stacks; `/ma` also includes
full memory. No debugger registration, global security setting, installation or
native/debugger execution occurred in this implementation batch.
