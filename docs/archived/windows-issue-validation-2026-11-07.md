# Windows issue validation — 2026-11-07

Qualification is in progress on `codex/pr557-audit-repairs-20261012`, starting
from `acbb7b362b7e0aa423ab9bae3126901fb6c21f31`. The
[machine receipt](windows-issue-validation-2026-11-07.json) records exact repaired
code blobs, original failures, per-case outcomes, report hashes and remaining
scope. Earlier observations retain their source state; this is not a final-tree
full-suite result.

Through the next indexing and tooling cohorts, the latest1886
observations are1880 passes, five failed published-index cases and one Linux-only exclusion.
No runner timeout or native crash is observed. The failed cases include actual
25-second operation-deadline exhaustion; they are not accepted or omitted.
The publication commands pass. The gate initially passes43/44; its failed
Windows authority inventory check requires the exact eleven portable replacement
IDs after the readiness split. Its focused recheck qualifies that owner; the other
43 cases retain their passing source observations. Its initial documentation failure was a missing explicit
roadmap reconciliation label; the matching date label is restored and freshness
passes without changing the drift assertion.

Node **26.13.0**, Windows x64, ABI147: native verification exits0 with all37
required probes successful. Eight patched packages,30 target files and81 hunks
verify without modification. The readiness receipt is refreshed; the complete
log contains zero warning/error lines. Runtime lifecycle and vendor qualification
are separate checks.

The initial refreshed census contains353 open issues. Changed fixtures and the existing
checks named by those issues produce an explicit2,166-case candidate inventory after both bounded partitions.
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

The next five reports extend the latest observations to512 distinct cases:
511 pass, none fail or time out, and the same Linux-only exclusion remains.
They include all148 selected shared-storage cases and the real Windows API7
qualification. These component observations retain their execution/source states;
they do not constitute a final-tree full-suite pass.

The first API7 run passes21/25 cases. Four root-program requests panic in the
native numeric option decoder because the adapter supplies tsconfig-style strings.
The worker now uses the pinned SDK's numeric enums, with producer2 invalidation.
All seven actual vendor cases then pass, including original snapshot isolation,
host-file refusal, cancellation after both children start, retained template parity
and successful disposal/zero exits. All11 projection contracts pass again.
The shared-I/O cohort initially passes58/59. Its scheduler drain fixture reads an
original completion observer before that continuation runs; one event-loop turn
now synchronizes the assertion without replacing the observer or relaxing pending
ownership. Both shutdown/drain and terminal-handoff checks pass.

The next storage cohorts pass100/100 and107/108. The latter fixture incorrectly
expects descriptor closure to retire an independent writer lock. Its repaired
original-owner recovery passes without rereading bytes or publishing a pointer.
Trace parity now requires the actual one-statement page and both current related
endpoint indexes; complete artifact/SQLite, pagination, corruption and cancellation
checks pass. Optional sqlite-vec is excluded from this acceptance target.

**#1701/#1597:** full source/follow-up review and their focused matrices qualify
both issues. Source `5be405ff5ea0a383f50ab1db5ab6d0581c721cac` is pushed;
GitHub readback confirms both closed as completed. Native manifest intake proves early logical-byte
rejection, exact Unicode boundaries, independent canonical identities and retained
world/runtime/artifact/layout negatives. Provider merge measures2/4/8 sources in
one/two groups: preparations1/1/1/2, rows6/12/24/24 and decoded logical JSON
bytes2074/4148/8296/8296. Idempotence, last-group failure, mutation, abort, syntax,
namespace and reference negatives preserve atomic selection. These are logical
work/decoded-byte observations, without heap/RSS or speed-multiplier claims.

**#1528:** the hosted six-case failure first exposes obsolete `sqlite.use`.
After removing it, real builds expose an AST-versus-published kind mismatch and
insufficient whole-run admission for multiple fresh processes. Profile v2 keeps
the normal Tree-sitter publication route, canonical CLI and exact identities;
direct AST export kinds remain unchanged. Structured progress retains info while
refusing warning/error levels and failed statuses. Nine preflight/direct-source
controls pass. The original-world recheck now passes after a circular disposal-guard repair;
five real published-index cases remain unqualified; the original
25/30-second bounds remain unchanged. A separate single-build CPU diagnostic
exits0 in11.684 seconds and is not acceptance evidence. Useful bounded execution,
current v2 comparisons and classification of tiny-index validation warnings remain.

**#131:** all seven hydrated-risk budget cases and four surrounding acceptance
checks pass. Coverage includes oversized full/partial metadata, accumulated
hydrated details, exact-fit/over-limit boundaries, emitted JSON bytes and token
estimates, deterministic retention and no source reads for rejected candidates.
All eight publication checks pass, including44/44 gate cases with zero failures,
timeouts or skips. Repair/receipt source `c5958def09fd0c6bdef37dad7be1f7979fe389db`
is pushed; GitHub readback confirms **#131 closed as completed**.

**#1187:** the actual heap-maintenance fixture passes insertion-time expiry,
negative results, LRU reordering, reinsertion, bounded compaction and the
20,000-entry/5,000-expiry trace. Actual propagation CPU/event-loop measurements
and output parity on high-cardinality call/usage inputs remain; keep it open.

Broader quota application (#1267), package/build closures (#1559), TS7.1 consumer
migration (#1155), live/spilled semantic maintenance (#1516), broader revision
oracles (#1528), remaining candidate cohorts and issue-specific runtime/performance
qualification are incomplete. Editor work and Tantivy native qualification retain
their user exclusions. Nine partial issues (#1187/#1267/#1559/#1155/#1516/#1528/
#1739/#1697/#1765) have current implementation/evidence/gap summaries with
verified GitHub readback.
A fresh post-closure census confirms349 open IDs and excludes #131/#1597/#1701/#1682.

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

## Current follow-up repair batch

The next three cohorts pass81/82,89/90 and87/90 before repairs. The readiness
timeout is an oversized aggregate: eleven independent fresh-process cases retain
all36 denial and36 prepared-entry assertions, information/library behavior, native
activation and policy/patch/ABI negatives. Every replacement passes under30 seconds;
ordered-lane and script-governance inventories remain complete. Original failures
are retained, not converted to passes.

Managed operational verification lost the private scratch-recovery association when
wrapping a pending failure. The wrapper now retains the actual WeakMap capability;
public lookalike fields grant no release authority. The original reuse/update fixture
and36 surrounding original-observation controls pass.

Confidence replay now admits numeric scores only from current, fresh component
evidence. Obsolete observations remain unknown history; current measured zero,
stale evidence and forged components stay discriminating controls. The strict
throughput schema now matches existing report/comparison3 and input2, preserving
unknown-field, version, scope and count rejection. Tooling then passes75/76 before
the schema repair and its focused recheck passes.

The next indexing cohort passes99/100. Its repaired native-config fixture explicitly
selects YAML top-level mode, distinguishes document ownership from native sections,
retains XML source gaps, and requires all four native grammar routes. Focused
YAML/XML and metadata checks pass; unavailable routes cannot silently pass.

A published-index disposal refusal was recorded as an external prerequisite for the
very recheck it awaited. Only this owner's actual refusal is privately branded, so
the recheck can finish while foreign reader observations stay binding. The real
original-world regression passes in25.2 seconds. The pending-reader case still
exceeds its25-second operation admission locally; no deadline/retry is relaxed.

Native-flow qualification retains six1x/2x/4x flat/many-function samples. Logical
construction high water stays33,368 bytes while produced rows grow; unavoidable
parser/anchor state is separate. An actual paused three-row writer batch encodes748
bytes and stops further construction. Batch sizes3/7 preserve every ordered row,
ID, source/evidence reference, coverage and canonical hash. All four native-flow
ownership/abort/partial/append/finalize cases pass; #1682 is qualified and closed at `cb93ab655cf6532428e90676069506bfc4abb88a`; exact GitHub body/state readback is verified.

Hosted run42393104073 at5be405ff passes gate, Rust, Windows authority, all three
native-inspection jobs, and Windows native indexing22/22 plus API7 vendor7/7.
General jobs fail: Windows5 revision cases, macOS1 circular-guard case, Ubuntu
that guard plus2 memory-encoded child failures. Both encoded cases pass locally;
failure output now retains the child signal/error. Hosted qualification remains
incomplete. No local Linux/WSL execution occurred.

Four additional issues (#1214/#1272/#1139/#1148) have readback-verified current
implementation/proof gaps. The ordinary bootstrap banner still loses typed recovery
actions (#1272); compressed word handles remain unimplemented (#1139); JSONL
reference-process lifecycle/type-consumer qualification remains (#1148). They stay
open even where adjacent starting checks pass.

The context-delivery/language/map cohort passes100/100 at `cb93ab655cf6532428e90676069506bfc4abb88a`,
with no failures, timeouts or skips. Candidate coverage now includes1727
of2,166 selected IDs;439 remain unexecuted, separately from the
additional surrounding/gate controls.

The graph/retrieval cohort passes98/100 initially; actual-source span repair and
isolated cold parity setup then pass. The latter keeps the original query and
real memory/SQLite results, while requiring positive code/prose witnesses. Its
rank/score differences remain recorded diagnostics, not a rank-equivalence claim.
The surrounding34 controls reveal a stale report-only corpus injection point;
all19 response cases then pass at the current explicit seam. All7 separate
real-artifact corpus cases pass without production admission changes.

The next embedding/semantic cohort passes100/100. A160-case indexing cohort
passes159 and times out the three-command cache wrapper. Phase receipts show
successful full indexing followed by both standalone widths; no native exception
is observed. Two independent cold cases retain the full inline build and the
standalone8-to12 sequence on all12 sources, with every cache/ONNX assertion.
They pass in23.6/20.4 seconds; CI ordering expands in-place, and the five-lane
audit reports zero missing/duplicate/mismatch/overrun entries. Required CI count
changes249→250; other lane counts stay3214/44/23/11. Original timeout reports
remain historical; only the fully passing documented replacement is retired.

The API report imports620→558 modules after moving unchanged directory selection
to its pure owner and using direct artifact/presence owners. One sample per arm
is756.9/757.2ms and supports no startup-speed claim. Five actual Windows CLI
cases and selected/published-root authority pass. An index-loader check initially
hits the inherited missing trusted-config path; the explicit task environment
recheck passes with its contracts unchanged. The actual shared-module performance
budget check passes with existing thresholds. macOS child qualification remains.

A read-only diagnostic classifies the six tiny-index warnings as optional risk
flows/partial flows, three disabled dense-vector channels, and absent LMDB. The
real-index profile still needs an executable exact warning assertion. A failed
cohort generator briefly selected an unfiltered run; its owned tree was stopped
immediately, no acceptance was claimed, and launchers now fail on errors/empty
selectors. Subsequent cohorts retain exact selection receipts.

The ready batch passes format, config/environment, generated freshness, command
and workflow contracts,44/44 gate cases and diff checks. The legacy default
LSP/embedding gate also had a path to a previously deleted dimensions wrapper;
its inspected source duplicates the stub width-transition/cache assertion now
owned by the bounded pair. The gate selects both actual case IDs at30 seconds
and the current wrong-width/cached-vector validator. Real default routing under
an explicit inert spawn adapter, test environment and timeout/JUnit controls pass.

Hosted CI2353 atcb93ab655 passes all native, authority, Rust and gate jobs. Windows
and Ubuntu serial runtime budgets each pass189 and fail four revision deadlines;
both original-world reader ownership cases now pass. Earlier Ubuntu encoding-child
failures do not recur. macOS passes32 compiler cases and times out one API CLI
child; its source qualification remains open after the measured coupling repair.
