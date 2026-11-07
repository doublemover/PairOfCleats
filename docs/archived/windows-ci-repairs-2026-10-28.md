# Windows CI repair and stable toolchain update

The focused Windows native recheck passes **15/15** cases, including all 13
originally failing Windows index-workflow cases and two controls. The maximum
fixture duration is 28.0 seconds; deadlines remain 30 seconds, one job, one
indexing thread, zero retries and no native-status redo. Twelve affected contract,
ownership and rendering controls also pass after repairing four fixture defects.
The [receipt](windows-ci-repairs-2026-10-28.json) retains every outcome and source
hash. Author-workspace `.tmp/` paths are historical evidence, not checkout inputs.

## Hosted failures and repairs

Original CI run `40809074059`, head
`319764dca9acfd34155da8a59c3a273fac7c63e1`, passed policy, gate and Rust checks.
The Ubuntu/macOS setup guards expected PHP 8.4.26 while the action supplied
8.4.27. Windows attempted the deliberately unqualified managed gopls build, then
failed its required startup witness. Its authority cohort stopped at incremental
reuse. Native inspection reported Windows 18 passes/two failures/11 timeouts,
Linux 28 passes/three failures, and macOS 20 passes/11 failures.

- CI now selects stable Node 26.13.0, PHP 8.5.12, Rust 1.99.1 and .NET SDK
  10.0.403/runtime 10.0.14. Exact Go 1.27.3, gopls 0.24.0, csharp-ls 0.28.0 and
  PHPactor 2026.10.07.0 were already current. .NET setup uses the immutable v6.0.0
  commit; native artifact upload uses v7. Runtime compatibility minimums remain
  separate from selected execution pins.
- A CI-only gopls owner builds the pinned module under fresh runner-temporary
  routes, checks the selected SDK, executable version, Go module/build metadata
  and SHA256, and publishes paths only after successful verification. It grants
  no product managed-install allocation qualification. Required actual LSP
  startup remains. Negative controls cover failed/truncated builds, wrong SDK,
  wrong package/version and command files outside runner ownership.
- Cleanup requires the suite's own cache-selection receipt; a setup failure no
  longer triggers a secondary missing-receipt exception or ambient-root deletion.
- Incremental reuse now supplies actual files, stats and source hashes. Positive
  reuse, deletion, changed size and identical-stat/wrong-hash negatives pass in a
  portable fixture. The existing physical symlink escape remains in its capable
  hosted authority owner; no new local symlinks were created.

## Native timing and coverage ownership

Catalog discovery no longer eagerly imports retained graph execution or the
queue executor. Indexer loading remains inside its retained execution owner and
rechecks cancellation and source authority after the import. An import witness
asserts neither execution owner loads during catalog discovery; actual retained
graph and indexer lifecycle controls pass.

The harness tracks selected fields instead of sending redundant Up keys. It
uses real paste/input events and relative paths with spaces resolved by the
native child's unchanged cwd. The streaming screen reader consumes each fragment
once, retaining a bounded CSI and screen grid. Every split boundary in escape,
Unicode, OSC and cursor samples matches the original reconstruction; repeated
observations consume no old input again.

Seed indexes use the same full/partial public `buildIndex` producer and options
in process, retaining successful producer outcomes. The build-search case uses
the supervisor's actual strict canonical artifact-validation receipt, including
unchanged pointer/state observations, instead of redundantly starting that same
validator again. Its public CLI search and expected indexed source remain.

Snapshot mutation cases each retain their native keyboard → supervisor → public
CLI operation and original mutation assertions. Their persisted-list assertions
use the CLI's exact `listSnapshots` owner. The new independently bounded populated
list case retains the full native list boundary and additionally verifies ID,
label, tags and frozen state. Empty-list and snapshot-show cases remain. No
assertion was dropped; the former two-operation UI wrapper is now explicit
producer/read coverage across separately bounded cases. Native exit status,
terminal restoration, descendant reaping and final job-state assertions remain.

The contract fixture now enumerates the catalog's recovery entry explicitly.
Indexer fixtures initialize their declared Git repositories: uninitialized nested
directories previously resolved to the author's checkout. Cleanup refusal and
foreign-job authority assertions are unchanged. A duplicate `comment-join` order
entry added in `f9f1cfa05` was removed from ci-lite; the original ci-long entry,
script, inputs, assertions and execution boundary remain. Regenerated governance
reports zero missing IDs, duplicates, manifest mismatches or timing overruns.

## Qualification limits

Node 26.13.0 was downloaded from the official release and its ZIP SHA256 checked.
Fresh native/patch verification exits zero without warnings/errors: 37 required
packages, 33 routes, eight patched packages/26 targets/61 hunks, ABI 147. The local
native checks use the recorded existing debug binary, SHA256
`641e194e04550eb28fbfba8a510574d5c3788070de1b23e0eb82ec467b52cfe2`;
they do not qualify compilation with Rust 1.99.1. Hosted setup, Rust compilation,
platform authority and Linux/macOS execution require the resulting hosted run.
No WSL, elevated launch or local physical symlink fixture was used.

All eight publication checks pass, including 40/40 gate cases. Latest-stable npm/native/API and remaining tool-recipe
upgrades are a subsequent batch; this receipt does not claim they are installed.
The stopped full-suite campaign, its 25 outstanding failures and unrun scope
remain separate. No new full-suite run was performed.

Official selections: [Node](https://nodejs.org/en/blog/release),
[PHP](https://www.php.net/downloads.php), [Rust](https://blog.rust-lang.org/releases/),
[.NET](https://dotnet.microsoft.com/en-us/download/dotnet/10.0),
[Go](https://go.dev/dl/), [gopls](https://github.com/golang/tools/releases),
[PHPactor](https://github.com/phpactor/phpactor/releases/tag/2026.10.07.0),
[.NET action](https://github.com/actions/setup-dotnet/releases/tag/v6.0.0).
