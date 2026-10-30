# Owned SQLite child progress and real wrapper controls — 2026-10-28

Source `c4700800c55f03527f844b778a0a266a1a6cc055`, tree
`41c3125214189c7f2af3949c90b4d713f8c3d106`, branch
`codex/pr557-audit-repairs-20261012`. Local/unpublished and functionally unqualified.

The actual diagnostic child now writes bounded progress alongside its launch,
ordinary-exit and bounded output records. Up to 64 events bind nonce/PID/sequence
to a closed phase set: initialized, SQLite entry, before/after native import and
before/after SQLite update. Appends close before returning to application work.
Normal non-collector routes have no active progress context and create no files.
The helper loads lazily inside the actual SQLite child, preserving parent startup.

The collector admits complete progress lines from its own attempt. A partial final
line retains the last completed event with partial status. Foreign identity or
invalid committed events fail collection without erasing an already demonstrated
target exception. Missing/partial progress cannot claim complete diagnostics.
The last JavaScript checkpoint supplies context, never native fault attribution.
Native-import errors keep original resource/cause observations; diagnostic writes
before/after import cannot be mislabeled as a missing binding.

Six ordinary real-Node child controls are authored: asynchronous work finishing
after module import, nonzero exit, bounded/truncated output, invalid launch context,
simulated native-style exit without a dump and a real owned phase checkpoint.
Three fixture-controlled collector cases cover complete, interrupted and foreign
progress. All earlier minidump/collector/boundary assertions remain. **All nine
controls are unexecuted**; no child, CDB session or native crash ran in this batch.

Format/ESLint, six changed JavaScript syntax checks, static inventory and whitespace
checks passed; shared-module analysis found zero cycles. Dependencies/setup inputs
are unchanged. #248 remains partial for actual wrapper/CDB/native lifecycle/symbol,
immutable replay and crash-attribution qualification. Counts remain 482 pending /
146 partial / 90 unresolved across 718 open issues.
