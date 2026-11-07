# Sublime native package acceptance and portable SDK refresh

The actual Windows Sublime Text **4192 / embedded Python 3.3** host passes all
three package cases: **packed, unpacked, and legacy/shadowing**. Each registers
exactly **61 commands**, loads the canonical contract resource, retrieves the
expected indexed `needle.js` result, updates/reloads the package, retrieves the
second query, uninstalls, and exits naturally. Child reaping, desktop
isolation and private-handle closure are asserted. No editor window reaches the
input desktop; the installed editor and its normal profile are untouched.

The [machine receipt](sublime-native-closeout-2026-10-29.json) preserves exact
archive/host/source hashes, all native outcomes, the original failed observation,
and bounded control reports. Raw `.tmp/` paths are historical author-workspace
evidence. The source parent is `8a79cc7c901380fd8afaa64d235d19600cf21c41`.

## Demonstrated cancellation and repair

The original packed attempt registers its commands and starts the correct search,
then receives `on_post_save_project`. A bounded native call trace identifies
`plugin.py`'s save handler invoking `operations.invalidate`: the captured epoch
changes from zero to one, and the real completion rejects its original epoch.
The trace separately observes the earlier project-load event before submission;
this is not an attribution based on the final log line. The native failure and
the failing unchanged-save regression remain recorded.

Native project saves also persist unrelated editor state. Capture now retains its
first admitted source context outside the shared lock. The save handler preserves
work only when the current folders, project identity and PairOfCleats overrides
match that context. Actual changes and unreadable context revoke the epoch;
project loads/reloads keep unconditional invalidation. A capture interrupted by
invalidation cannot adopt the newer epoch. Seven direct inner controls cover
unchanged saves, changed settings/folders/project identity, reload, unavailable
editor APIs and the capture/save race. Existing lock-cycle and ownership controls
remain passing.

The original full native packed workflow then passes. After the final fail-closed
guard, packed, unpacked and legacy/shadow cases all pass with archive SHA256
`3e498129239c5943edbfafd730a831036e3012757969edba5e8452d050be42d0`.
The assertions and original deadlines remain unchanged. Optional internal native
operation tracing is bounded, delegates to the original operation exactly once,
and is removed on probe unload.

## Stable managed tooling

The additional recipe audit confirms current pinned Git LFS 3.8.1, ripgrep 15.2.0,
SCIP 0.10.0, cargo-cyclonedx 0.5.9, Graphviz 16.1.0 and PHPactor 2026.10.07.0.
Clangd already selects an official stable release; Rust Analyzer uses the
selected Rust toolchain's component. Their existing selection policies remain.

The portable Windows .NET recipe was still on SDK 10.0.402/runtime 10.0.13,
despite the current CI pins. It now selects **SDK 10.0.403/runtime 10.0.14** with
Microsoft release-metadata SHA512 and actual Azure Blob HEAD sizes for x64, x86
and ARM64. Prerequisite diagnostics use those same constants; explicit trusted
consumer fixtures use the canonical versions. This is recipe/consumer-contract
qualification, separate from downloading the 300 MB SDK or qualifying a real
managed language-server session.

## Checks and issue closure

**36/36 affected fixtures pass**, including the complete headless Sublime family
and four managed-SDK/prerequisite controls, with 30-second per-case limits, one
job, zero retries/native-status redo, no failures, timeouts or skips. The three
native host cases are serial, bounded independent executions. Publication checks
and the verified completed GitHub state are retained in the machine receipt. #1289's complete
Windows package acceptance is demonstrated; broader editor/platform qualification
continues under #630. The separate VSIX, crash-log and cleanup P1s remain open.

Automatic approval review rejected cleanup of the five disposable native-host
copies with “blocked by policy”; those runtime copies remain in `.tmp/`.
