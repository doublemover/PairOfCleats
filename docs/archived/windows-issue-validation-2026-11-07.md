# Windows issue validation — 2026-11-07

Qualification is in progress on `codex/pr557-audit-repairs-20261012`, starting
from `acbb7b362b7e0aa423ab9bae3126901fb6c21f31`. The
[machine receipt](windows-issue-validation-2026-11-07.json) records exact repaired
code blobs, original failures, per-case outcomes, report hashes and remaining
scope. Earlier observations retain their source state; this is not a final-tree
full-suite result.

Latest observations cover **2,499 distinct cases:2,482 pass,16 fail and one
Linux-only fixture is excluded on Windows**. Seven failures reach the outer30-second
limit. Four published-index transition cases and12 native-index cases remain
unqualified. Original failures and unsuccessful diagnostic controls are retained;
no retry or relaxed deadline counts as acceptance. Current publication checks are
recorded with the eighth qualification batch below.

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

## Current validation and closeout wave

Cohort23 passes163/164; moving native lifetime/authority into the shared runtime
repairs its production-to-tooling boundary. Cohort24 passes210/220 initially; all
120 affected rechecks pass after retaining exact LMDB inspection failures and
repairing current manifest, path, tier, error-wrapper and inventory fixtures.
Neither native close nor resource release is retried or inferred from metadata.

The content/TUI cohort passes70/86. All21 logical content/source-piece cases pass.
Twelve native-index cold workflows and the native query/source case fail their
existing timing bounds; two initially hit the outer fixture limit. Separate
portable file/export/escape and explicit alias-classification controls pass. The
original physical link assertions move unchanged to their capable Windows owner;
its new identity remains explicitly unexecuted locally. Isolating application
home does not resolve native report/workspace timing and is not closure evidence.

All138 serial performance cases pass across the original cohort and one focused
scheduler recheck. The scheduler and actual triage context CLI use supported
lexical seeds for their lexical consumers, preserving every original positive
queue/source/identity assertion. SQLite raw20-sample warm p95 is164.9ms against the
unchanged7500ms Windows bound; both original queries retrieve the indexed source
before sampling and on every sample. Work/resource and import-count results do
not establish a general latency gain.

Published-index profile v3 overlaps exactly two independent original build worlds
while preserving ordered candidate revisions, normal workers, original command
inputs and25s/30s limits. Its join retains both failures and original resource
observations. Actual validation must have zero issues and exactly the six declared
optional omissions, matching terminal warning count and generation. Recheck20.0s
and pending-reader16.7s pass; the four transition cases still exhaust admission.

Full original/follow-up reviews close **#1646/#1654/#1657/#1699**, with exact
CLOSED/COMPLETED and body readback. #1643/#1707/#1722 have concrete remaining
provider-lifetime, source-occurrence and persisted-reference gaps; #1528 records
the v3 execution proof and remaining failures. A complete fresh GitHub census
contains **345 open issues**;16 partial issues now have current evidence/gap
summaries. Of2190 selected IDs,2187 have observations. The only unexecuted
selections are deferred Tantivy, optional sqlite-vec and the conserved hosted
physical-alias qualifier. This does not claim all open issues or the full suite pass.

The fourth repair batch passes format, configuration/environment, generated
freshness, command/workflow contracts,44/44 gate cases and diff checks. Fresh
native/patch verification passes37 required probes and eight packages/30 files/
81 hunks with zero unexpected warnings or errors. The JSON receipt binds exact
source blobs, check logs and hashes; earlier observations remain source-bound.
No new native crash is observed. The17 timing failures above remain open.

## Startup, recovery and hosted CI follow-up

The current local selection contains2,195 IDs, with2,192 observed. Tantivy and
sqlite-vec remain outside this target. The physical-alias case remains unexecuted
locally but passes in the40-case hosted Windows authority cohort at98d68675c.
The new native search controls reveal additional seed/terminal failures; the21
local failures remain explicit, including the later failed seed after the17.9s
query/source pass. Narrow and first-failure narrow controls pass16.7/26.2s. The
handshake rejection witness remains unqualified; no retry or diagnostic control
is counted as closure.

Build entry imports fall2,409→2,197 after selecting the actual build owner and
activating ESLint/terminal-kit only for admitted lint/interactive work. Both
original eager imports fail the new regression under the actual committed owner
source; the repaired guard and four actual lint controls pass. These are import
work observations, not a general startup latency claim.

Ordinary bootstrap errors retain typed reason/mismatches and executing Node/npm
context through the same read-only wait/verify/repair/install selector as explicit
diagnosis. A known failed native probe now selects repair despite intact file
metadata. Nineteen readiness/identity/recovery cases and six CLI/progress/doc
controls pass; no repair runs automatically. #1272 remains open for its full
runtime/selection/concurrent-replacement qualification.

[CI2355](https://github.com/doublemover/PairOfCleats/actions/runs/42409871998) at
98d68675c passes22 Windows native-index cases, seven actual TS7.1 vendor cases,
all three native-inspection jobs, Rust and authority. All six real published-index
cases pass; the four transition cases take12.7–13.1s. The Windows serial cohort
passes192/193 and fails the distinct-PID assertion:12 serial child executions
report11 numeric PID values. These hosted observations remain separate from
local failures and do not qualify later source.

Graph benchmark v3 checks original spawned PID plus Node process-start identity,
accepts recycled PID numbers and rejects repeated warm generations. Query-worker
qualification counts five actual launches/closes, retains the reused live memory
worker and preserves the global live/retiring cap. Both original24-child graph
wrappers exceed30s locally. Four capsules retain both original shapes, six pairs
per shape, all48 children, alternating order and every cross-shape/source/cache
assertion. All four pass15.3–17.8s; the generation, retirement and CI-selection
controls also pass. All144 cases in the selected serial cohorts have passing
source-bound observations. Raw48 graph samples and original failures are retained.

Fresh native verification again passes37 probes/eight packages/30 files/81 hunks
without warnings or errors. The pinned Rust1.99.1 build is clean and leaves the
original binary hash unchanged; the unqualified shell's1.93.1 failure remains
recorded. Format and the five preceding publication checks pass. The gate passes
43 cases initially, then its exact inventory fixture is repaired for the four
graph capsules and passes a focused recheck with four ownership/budget controls.
No full gate or successful broad cohort is repeated.

The implementation checkpoint is `98be3a04c51b00818a18a2449edf5b2a4e1a7432`; every recorded final
source blob matches that committed/pushed tree and the PR head was read back.
#1272/#1528 remain open with concrete updated scopes and exact body/state readback.
CI2355 subsequently completes Ubuntu/macOS general jobs successfully; its sole
Windows failure is the PID assertion repaired above. Qualification of later
source remains separate. Final read-only process inventory finds no project Node
or native TUI process left running; unrelated applications were untouched.

## Native search and visible control denials

The sixth batch is implemented at `5439116a7b57ef14be42b18447e6491f82775020`.
The native renderer put alerts after long session identities/paths in wide
headers and omitted them from compact headers. The new long-identity denial
regression fails before the repair. Both headers now prioritize the original
alert; the live-control guard and failed-search contract stay strict. All157
Rust tests pass, together with rustfmt, the actual binary build and Clippy with
warnings denied. The receipt records the changed binary hash and source blobs.

Native-search setup now calls the canonical Stage1 build API with its original
ten-second deadline covering import, actual work and teardown. It requires
published sparse retrieval, the exact requested stage and zero validation
issues. Every real native keyboard, supervisor, query/source CLI, positive hit,
privacy, cancellation, terminal-restoration and descendant assertion remains.
Input correction uses paths relative to the actual native/supervisor cwd,
resolving to the original file and repository targets; realpath assertions prove
the selected scope. This removes repeated author-path typing from the recovery
budget. The ineffective Windows bracketed-paste diagnostic remains a failed
observation and is removed from the fixture.

The first strict native batch passes13/15. Focused repairs resolve both remaining
cases; all15 native-search cases now have passing observations. First-failure
recovery passes17.2s at80 columns and16.9s at32 columns; scope switching passes
21.9s. The handshake denial and subsequent real query pass. Fifteen additional
failure-owner controls pass, including actual supervisor/CLI cause contracts,
successful empty/nonempty responses, malicious projection, original pending
resources, truncated capture and recovery after a failed command. The machine
receipt retains each original failure and the affected recheck, rather than
claiming a repeated final-tree full-suite pass.

Windows CI now explicitly runs the entire native-search family after building
the actual candidate binary. It retains serial30-second bounds, zero retries,
disabled native-status redo and terminal/binary/process evidence uploads.
The44-case gate and all preceding publication checks pass. Command-surface
validation initially inherits a nonexistent trusted-config path; clearing that
selection only in the validation process permits the unchanged authority guard
to pass. Both observations are recorded.

[CI2357](https://github.com/doublemover/PairOfCleats/actions/runs/42415823849) at
`8d91e0634b4c594070393977bac4f6e9395f7720` passes the gate, Rust, all native-inspection
jobs,22 Windows native-index and seven actual TS7.1 cases, and40 Windows authority
cases. Its general jobs are still running at this observation. That checkpoint
precedes this batch. The remaining16 local failures are four revision deadlines
and12 native-index cases; snapshot-list-populated is the sole outer timeout.

## Windows contained admission and remaining deadlines

The seventh batch is implemented at `9c8bf59c24a7d9da791eef325da2df6670592df3`.
A bounded cold-seed parent profile attributes about6.25 seconds to contained
ancestry checks. Windows asynchronous admission now awaits the same ordered
root/component metadata and native canonicalization before and after opening.
Each read retains its exact descriptor, final verification and original close.
The change adds no ancestry cache, public option or weaker path policy.

The four-reader held-admission regression fails before the repair. All29
selected file/hash/manifest/publication controls pass afterward, including exact
wide integer identities, content/digest changes, cancellation, original failed
close/scheduler observations and independent publication evidence. New portable
classification controls reject root/ancestor/leaf aliases and canonical escape
before payload open. A held post-open probe retains its actual fd until the
original failure settles, closes once and publishes no verification bytes.
No local symbolic link or permission change is needed for these controls.

Four serial original/async/async/original process invocations read64 distinct
160-byte files with four readers and four trials each. Every read matches the
same bytes, SHA256 and extent. Eight raw samples per arm give medians336.46ms
and211.03ms; the observed maximum5ms-ticker gap is23.11ms versus8.40ms. This is
a small metadata-heavy workload observation, not a full-pipeline latency claim.
The receipt embeds every sample, source identity and original control command.

All16 remaining local failures are attempted once after the change: nine fail
their inner witness/deadline and seven reach the outer30-second limit. No retry,
deadline increase or disabled backend is used. A separate500ms two-world startup
abort retires correctly. Every later captured TypeError is the explicit
`ERR_SOURCE_REVISION_SCENARIO` work-deadline refusal from `checkRun`, using the
existing `sourceScenarioError` constructor. Both bounded profiling timeouts are diagnostic
failures and do not count as acceptance. The initial worker-overwritten profile
is explicitly excluded from attribution.

Format, all five publication checks and44 gate cases pass. All84 preceding
report records and unrelated receipt fields remain unchanged. CI2358 at2c0d05182
passes22 Windows native-index, all15 native-search and seven actual TS7.1 cases,
plus gate, Rust, authority and all native-inspection jobs. Its general jobs are
still running at the recorded observation; it predates this admission change.

## Eighth batch: actual runtime selection and inspection replacement

Two independently bounded regressions replace an actual receipt or journal
after its initial read. Ordinary startup and explicit JSON diagnosis retain the
same original reason, identity differences and recovery action: wait, with no
install command. The ordinary route retains real SQLite/parser probes through
explicit adapters to this checkout's prepared packages. Both cases pass in
under two seconds and join the ordered CI-lite lane; all3,218 existing entries
and their relative order remain intact.

The installed-runtime helper executes ten actual process cases. Node26.12.1 and
26.13.0 share ABI147; both direct startup and an actual npm11.20.0 script reject
the changed full Node version. The npm process uses26.13.0 while its script's
PATH selects26.12.1. Ordinary errors and JSON diagnosis agree on exact paths,
version mismatch and verify-only recovery. Matching-runtime controls remain
explicitly metadata-only. Actual26.8.0-alpha.0.0.0 and26.8.1 executables each
refuse work and select the supported runtime without recommending an install.
All watched receipt, journal, lock, manifest and package-adapter hashes remain
unchanged. No runtime is installed, copied or linked; temporary fixtures retire.
This proves same-ABI **minor-version** drift, not a patch-only executable pair;
the existing identity comparator independently covers patch-only mismatches.

These are isolated metadata fixtures, never readiness receipts for an application
installation. Their prepared-package adapters preserve actual probe behavior
without pretending to qualify a separate dependency tree. The tracked helper
accepts explicit already-installed executable/npm paths, and the machine receipt
embeds all ten results, commands, actual runtime identities and binary hashes.
The ten process controls are separate from the2,499 discovered-case observations.

On exact20b92c986, hosted CI2359 now passes all44 native Windows workflow cases:
22 indexing,15 search and seven actual TypeScript7.1 requests. Windows authority,
Windows native inspection, gate and Rust also pass. General jobs remain in
progress at this snapshot. These hosted observations preserve the sixteen local
failures and do not turn the local campaign into a final-tree pass.

This batch is source-bound to `92720aec3ad1b4d8ef5678706ccdc048493e1281`.
Format and the final helper lint pass; configuration/environment, generated
freshness, command/workflow contracts,44 gate cases and diff checks pass.
All89 earlier report records are retained unchanged. Issue #1272 is closed as
completed with exact body/state readback; the fresh census has344 open issues.
The final process audit finds no project Node or native TUI process running.
