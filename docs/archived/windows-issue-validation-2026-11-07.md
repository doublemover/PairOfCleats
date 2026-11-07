# Windows issue validation — 2026-11-07

Qualification is in progress on `codex/pr557-audit-repairs-20261012`, starting
from `acbb7b362b7e0aa423ab9bae3126901fb6c21f31`. The
[machine receipt](windows-issue-validation-2026-11-07.json) records exact repaired
code blobs, original failures, per-case outcomes, report hashes and remaining
scope. Earlier observations retain their source state; this is not a final-tree
full-suite result.

Node **26.13.0**, Windows x64, ABI147: native verification exits0 with all37
required probes successful. Eight patched packages,30 target files and81 hunks
verify without modification. The readiness receipt is refreshed; the complete
log contains zero warning/error lines. Runtime lifecycle and vendor qualification
are separate checks.

The refreshed census contains353 open issues. Changed fixtures and the existing
checks named by those issues produce an explicit2,155-case candidate inventory.
Test selection is not full issue acceptance: original requirements, performance
evidence and external/editor remainders are reviewed individually.

## Executed checks and repairs

All runs use one job, one indexing thread,30-second fixture deadlines, zero
retries and native-status redo disabled. The first six reports contain255 case
executions. Their latest observations cover237 distinct cases: **236 passed,
zero failed, zero timed out and one legitimate platform skip**. The individual
reports remain authoritative where code changed during repair.

- Managed probe/verifier retention passes27 cases, including actual publication
  refusal and recovery after an original observation is revoked. Async
  minimization passes eight ownership/failure controls.
- Suggestion revision qualification initially exposed a proxy trap during
  admission. A bounded passive snapshot now precedes shared schema capture;
  all11 suggestion cases pass. The separate shared request-capture reflection
  contract remains unchanged.
- An inherited trusted-config path no longer existed. Production authority
  correctly rejected it. The suite-plan fixture explicitly clears that inherited
  selection, and subsequent campaign shells use an explicit fixture environment.
  The suite plan and three affected binding/scheduler cases pass. No user or
  machine configuration was changed.
- Proto and SemanticDB adapters still admitted only8.8.0 despite locked8.8.1.
  Both now use the exact shared8.8.1 profile, with adapter/producer4 and derived
  replay invalidation. Actual decoding, source joins and retained navigation
  pass. Overflowing wire lengths and unreviewed runtime versions remain rejected.
  [Upstream changes](https://github.com/protobufjs/protobuf.js/blob/protobufjs-v8.8.1/CHANGELOG.md)
  include overflowing-length rejection. No dependency downgrade or permissive
  version range was introduced.
- The expanded-report fixture expected obsolete GraphQL adapter2. Its assertion
  now matches the existing declaration/report3; the complete report-byte
  rejection still passes.
- The Linux ELF/clangd positive fixture is skipped on Windows. Its actual
  Windows unsupported-platform and portable authority owner,
  `indexing/semantic/native-toolchain-platform`, passes. No Linux or WSL run was
  performed.

## Issue acceptance

**#131:** all seven hydrated-risk budget cases and four surrounding acceptance
checks pass. Coverage includes oversized full/partial metadata, accumulated
hydrated details, exact-fit/over-limit boundaries, emitted JSON bytes and token
estimates, deterministic retention and no source reads for rejected candidates.
All eight publication checks now pass, including44/44 gate cases with zero
failures, timeouts or skips. Publication and GitHub readback remain before closure.

**#1187:** the actual heap-maintenance fixture passes insertion-time expiry,
negative results, LRU reordering, reinsertion, bounded compaction and the
20,000-entry/5,000-expiry trace. Actual propagation CPU/event-loop measurements
and output parity on high-cardinality call/usage inputs remain; keep it open.

Broader quota application (#1267), package/build closures (#1559), TS7.1 consumer
migration (#1155), live/spilled semantic maintenance (#1516), broader revision
oracles (#1528), remaining candidate cohorts and issue-specific runtime/performance
qualification are incomplete. Editor work and Tantivy native qualification retain
their user exclusions. No issue has been closed by this initial checkpoint.

Raw `.tmp/tasks/validation-20261107/` logs are author-workspace receipts. Their
hashes and results are preserved here; clean checkouts are not expected to contain
those temporary files.

The publication check initially stopped on the machine-selected Python3.13.3.
The strict generator requires repository-pinned CPython3.15.2 / Unicode17.0.0.
The official Windows embeddable archive was verified against Python.org's SHA256
`d012f3aa29cf07436dae8aea1fec0fd195c2612a0b059b1f915ae0afb9ad1f62`
and expanded under this task's temporary root. Selecting it for the check repairs
the environment without changing the machine's Python, PATH or security settings.
Generated freshness, command surface and workflow contracts then pass unchanged.
