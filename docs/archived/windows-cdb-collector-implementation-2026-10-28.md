# Scoped Windows CDB collector — 2026-10-28

Source `71ed56edf9e84ea11fb6587b4b2c63b8c49e8c9e`, tree
`7e3c2c6c9f8f22ce6430ff323bb2038d72e4769b`, branch
`codex/pr557-audit-repairs-20261012`. Source-only, local and unpublished.
The preceding minidump structure commit is `8d0e1a405`.

#248 now has an explicit optional CDB producer, rather than a directory that
pretends to collect dumps. The private capability is available to the actual
SQLite boundary and programmatic Stage3 owner; ordinary runs keep their launcher
and truthful unavailable state. The heavy IO implementation is lazy. Neither a
serialized capability nor a simultaneous fixture child runner is admitted.

The existing x64 executable is selected explicitly. The child-aware CDB session
uses an owned command file, fixed second-chance exception commands, default small
minidumps, bounded shared process capture and at most a 30-second deadline. Native
registration, installation, privilege changes, visible windows, shell execution,
network symbol paths, full-memory dumps and child retries are absent. Explicit
local symbol directories can be supplied; matching symbols are not yet qualified.

The original Node/CDB and supplied native input paths resolve to physical files
before hash/launch, then retain SHA256/extent/file identity before and after. This
handles the actual nvm4w executable alias without weakening writable evidence
containment or making links. These are on-disk identity observations, not proof of
every loaded memory page. The attempt records exact argv/cwd, application script,
safe environment value hashes and byte admission. Replay inputs remain references;
generation-qualified immutable capture is separate work.

The real child wrapper owns nonce/PID launch and ordinary-exit replies plus bounded
stdout/stderr files. It waits for process exit rather than treating asynchronous
module import as operation completion. Each append closes before returning to
application work. CDB's own exit cannot stand in for the debuggee's status.

The minidump parser validates the 32-byte header/version, bounded unique required
streams, target PID, exception/context, actual recorded exception thread, thread
contexts/stacks, modules and bounded CodeView records. Stream/aggregate string
extents, duplicate IDs, malformed/foreign/full-memory evidence fail. Normal exit
and simulated native exit without a dump report no-dump. A demonstrated target
exception is retained before later integrity, reply, publication or metadata
operations; independent diagnostics cannot erase it.

Storage reuses the actual admission, directory, contained-file, atomic-write and
subprocess owners: 16 MiB dump, 24 MiB declared attempt, 128 MiB family, 1 MiB per
output stream. Sampling bounds growth and unexpected files. This is cooperative
admission with sampled abort, not a hard OS quota. Unknown/pinned evidence is never
removed. Pending original resources retain admission; exact producer-owned metadata
reconciliation can run after settlement without repeating CDB/native work.

Twenty portable synthetic format cases and 26 Windows x64 fixture-controlled IO/
boundary cases are authored: positive target evidence/ordinary exit, simulated
status, wrong/missing identity, malformed/oversize/absent dump, bad replies,
debugger/launch failures, pending original result/error, unexpected entries,
changed runtime, actual capture-write and metadata-release failures, capability
and trust negatives, and the actual boundary's native/collector-failure paths.
Non-Windows collector IO is explicitly excluded after its unsupported-platform
assertion; portable format checks retain their own owner. These are **46 unrun
controls**, in addition to the prior 27. They launch no real collector or child.

Format/ESLint, eight changed JavaScript syntax checks, static inventory and
whitespace checks passed; shared-module analysis found zero cycles. No project
functional test, child, native operation, debugger, install, model or performance
campaign ran. Dependencies, Node pin and patches are unchanged.

#248 remains partial: actual wrapper/CDB/dump/lifecycle qualification, symbol
matching, forensic accepted-work/index ordering and immutable generation replay
remain. No native crash cause or closure is claimed. The 718-open source inventory
remains 482 qualification pending / 146 partial / 90 unresolved.

Primary references: Microsoft [CDB command-line and child ownership](https://learn.microsoft.com/en-us/windows-hardware/drivers/debugger/cdb-command-line-options),
[second-chance filters](https://learn.microsoft.com/en-us/windows-hardware/drivers/debuggercmds/sx--sxd--sxe--sxi--sxn--sxr--sx---set-exceptions-),
[normal minidumps](https://learn.microsoft.com/en-us/windows-hardware/drivers/debuggercmds/-dump--create-dump-file-),
[exception stream](https://learn.microsoft.com/en-us/windows/win32/api/minidumpapiset/ns-minidumpapiset-minidump_exception_stream),
[miscellaneous process identity](https://learn.microsoft.com/en-us/windows/win32/api/minidumpapiset/ns-minidumpapiset-minidump_misc_info).
