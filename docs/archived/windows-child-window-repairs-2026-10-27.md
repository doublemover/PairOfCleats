# Windows child-window and Sublime lock repairs — 2026-10-27

Source commit `bee92206ee0a63020ed920b99bf5fa16fc2f9abc`, tree `507a57095b9c7f17e2bef68d332fa077adba0a95`.
Windows x64, Node 26.12.1, branch `codex/pr557-audit-repairs-20261012`.
[Machine-readable receipt](windows-child-window-repairs-2026-10-27.json).

## Visible-window cause and repair

The actual-host tests used background flags, which did not isolate editor windows.
Sublime's Node runner requested a process group without suppressing a new console;
its cancellation helper and a copied-directory Python harness also lacked that
suppression. Shared Node runners and test launchers likewise omitted Windows
console-window suppression. These paths now request hidden/no-console creation.
Python 3.3 accepts the Win32 creation flag but lacks its exported constant, so the
existing runner uses the documented numeric fallback. Cancellation remains bounded,
keeps its process-group behavior and reports unconfirmed descendant settlement.
Raw bounded/test-helper spawn-option overrides retain their existing semantics.

The minimum-runtime fixture verifies an actual Windows child has no console
handle and retains the real owned-child termination check. Command-invocation
coverage observes the final spawn options through the real shared async/sync,
bounded-command and Node-test-helper paths, preserving literal command-shim argv.
All ordinary Sublime Python fixture launches now suppress console windows too.

The explicit native fixture remains outside automatic discovery. Its actual GUI
process starts on a private desktop through an explicit STARTUPINFO desktop field;
it has no input-desktop fallback. The final control verified assignment before
creating a visible-style test window, required that window absent from the input
desktop, then confirmed both children exited 0, reaped, and the original worker
desktop was restored and the private handle closed. No desktop switch, elevation,
registry or security-setting change occurred. No existing editor was terminated.

## Demonstrated GUI deadlock

Native Python 3.3 all-thread stacks show a reader holding the operation mutex
inside `is_current` while `Window.folders` waits for the UI thread. The UI
thread is in task publication waiting for that mutex; the settlement worker joins
the reader. This is a GUI lock cycle, not attribution of a native access violation.
Three bounded regression controls reproduced the lock cycle before repair.
An initial fourth control used nonexistent helper names; that authoring error was
corrected and is not counted as evidence of a product failure.

Context reads now happen outside operation and render locks. The issued epoch
is captured before the read, and the original state, request generation and epoch
are checked again afterward. Coalescing uses a pure admission check inside the
render lock; actual publication retains the full context check outside it. Five
inner controls pass, including invalidation during the editor call, no adoption
of a newer epoch, coalesced panel intent and sibling-request authority.

## Validation and remaining work

**38/38 focused fixtures pass**, including all 31 headless Sublime fixtures,
command invocation, four detached-tree cases, synchronous tree cleanup and the
runner contract matrix. No failures, timeouts, retries or skips. Every fixture
uses a 30-second deadline, one job/thread, zero retries and native-status redo
disabled. Format and the complete cheap front gate pass, including **40/40 gate
cases**. No dependencies, pins, patches, semantic producer versions, CLI or
configuration/artifact contracts changed.

**#1289 remains open.** Later private-desktop packed attempts are failures:
61 commands register, but the search scope reaches epoch 1 and produces no result.
The observed revocation still needs event attribution. The fixture deadline
terminates its owned host; no native search, natural-exit, update/reload, uninstall,
unpacked or shadowing pass is claimed. Immutable per-RPC files fix a separately
observed Windows replacement-sharing failure; the real project-load event is
observed before submitting the original query. Neither change retries the query
or relaxes its positive assertion or deadline. Thread dumping is explicit internal
diagnosis, disabled during ordinary native acceptance. All owned editor instances
have exited; the installed normal session remains untouched.

Historical raw receipts are under `.tmp/tasks/native-private-desktop-20261027/`,
`.testLogs/` and the logged disposable profiles; clean checkouts do not contain
them. Runtime-copy deletion was previously rejected by automatic approval review
with only “blocked by policy”; no alternate route was attempted. Copies remain.
This scoped batch does not establish full-suite, hosted-CI, performance, optional
backend, non-Windows, release or native-crash acceptance.

Windows process behavior follows [Microsoft's process creation flags](https://learn.microsoft.com/en-us/windows/win32/procthread/process-creation-flags)
and [STARTUPINFO desktop assignment](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/ns-processthreadsapi-startupinfow).
