# Native Windows process snapshots — 2026-11-04

Hosted [CI41917690625](https://github.com/doublemover/PairOfCleats/actions/runs/41917690625)
at `ec78f3cb2` passes Windows authority but fails subprocess ownership: the
PowerShell snapshot helper reaches `engine-ready`, then exceeds its original
2000ms deadline before `script-start`. Its old launcher did not distinguish
stdin completion from payload parsing; the underlying delay remains unattributed.
The other four subprocess-ownership cases pass. The exact failure excerpt is
preserved in the [machine receipt](windows-native-snapshot-repair-2026-11-04.json).

The existing required node-pty Windows process-metadata binding now performs
Toolhelp enumeration directly. It uses the compiler's PROCESSENTRY32W layout,
requires complete enumeration, closes the actual snapshot before returning
rows, and reports enumeration and close failures independently. A bounded
fresh Node leaf invokes this operation with the original two-second deadline.
Its executable and module loader come from the current runtime and dependency
owner; PATH and SystemRoot do not select another executable. Application
NODE_OPTIONS preloads, including Windows case variants, are excluded from this
leaf. The operation never attaches to or detaches from a console.

The former PowerShell path resolver and dynamic-interop script had only the
replaced request owner and its fixture as JavaScript consumers. Their replacement
retains actual parent/helper lineage, full-end admission, invalid enumeration
after accumulated rows, confirmed native close, syntax/execution negatives,
empty-PATH authority, orphan/timeout descendant reaping and delete-pending checks.
No partial snapshot authorizes cleanup. Ten explicitly recorded fresh processes
pass in60.7–70.1ms each; the complete snapshot fixture passes896ms. All11 affected
checks pass with zero retries, timeouts or skips.

Bootstrap's existing native probe checks both successful enumeration and a real
invalid-handle error with confirmed close, in addition to its original two PTY
operations and natural exit. The old otherwise-loadable binding fails this probe
before rebuilding. Normal Windows bootstrap now compiles the patched binding
directly, preventing an upstream prebuild from omitting the repair and avoiding
npm's legacy source-build flag warning. The complete six-file package patch has
verified original preimages and reversible application.

The explicit Node26.13.0/Python3.15.2 source build succeeds. Its unchanged legacy
WinPTY sources emit narrowing warnings; the receipt retains all247 emitted
warning lines. The new snapshot function emits none, and no warning flags are
disabled. Fresh required-package, parser-route, ONNX lifecycle and patch
verification exits0 without warnings/errors:37 packages,33 language routes,
seven patches,26 targets and73 hunks. Hosted acceptance of this repaired source
remains pending. This does not attribute unrelated access violations or imply
complete platform/performance qualification. Author scratch paths are historical.

Twelve additional PTY/build controls pass, including ten fresh real terminal
lifecycles. Cleanup now resolves taskkill/tasklist only beneath the parent
launch's absolute Windows root and hides every leaf window. A launch-intercept
regression fails with the verbatim original helper and passes after repair;
invalid roots and unknown utility names fail closed. All four affected lineage,
real tree/orphan and timeout controls pass. The fixture intercepts the finite
launch owner without executing a hostile command or killing arbitrary processes.
Earlier malformed fixture literals remain historical construction failures.

All eight publication checks pass for this batch; the final gate has41 cases.
The machine receipt binds tested implementation files by SHA-256 and retains
the final verification output. Unchanged config/generated/workflow checks are
reused within this batch; affected cleanup checks and gate ran after the repair.
