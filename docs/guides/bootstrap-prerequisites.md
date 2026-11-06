# Source checkout prerequisites

Use **Node >=26.12.1 <27**, preferably the exact version in [.nvmrc](../../.nvmrc),
with npm and Git. Full bootstrap also requires Python 3 and a supported C/C++
toolchain. The required patched Perl parser is built from source even when other
packages have prebuilts.

CI selects **Python 3.15.2** from [.python-version](../../.python-version).
Local bootstrap accepts a compatible maintained Python 3. The locked node-gyp is
13.1.0; Python 3.12+ needs node-gyp >=10. Explicit Python selection follows
NODE_GYP_FORCE_PYTHON, npm_config_python, then PYTHON. Otherwise discovery uses
the Windows py -3 launcher and PATH. An invalid explicit selection fails without
falling back. Prerelease Python requires an explicit selection.

## Platform tools

On Windows, install [Python](https://www.python.org/downloads/windows/),
[Git](https://git-scm.com/download/win) and Visual Studio or its
[Build Tools](https://visualstudio.microsoft.com/downloads/) with Desktop
development with C++, the target MSVC tools, MSBuild and a Windows 11 SDK.
Discovery uses registered installations and SDK files; cl need not already be on
PATH. Explicit VCINSTALLDIR, npm_config_msvs_version and GYP_MSVS_VERSION
selections must agree with installed tools.

POSIX builds require Python 3, Git, Make and a C++ compiler supported by the
[Node build policy](https://github.com/nodejs/node/blob/v26.13.0/BUILDING.md#supported-toolchains).
On macOS this includes the selected Xcode command-line tools. Explicit CC and
CXX selections remain authoritative. See
[node-gyp prerequisites](https://github.com/nodejs/node-gyp#installation).

Ordinary bootstrap does not install machine tools, change global PATH, launch
WSL or alter security settings. The separate
[Windows prerequisite repair](windows-prerequisite-repair.md) plans an exact
reviewed vendor install/modify operation.

## Inspect, prepare and recover

From the application checkout:

    node tools/setup/preflight.js
    npm run bootstrap:ci -- --help
    npm run bootstrap:ci -- --plan --json
    npm run bootstrap:ci -- --status --json
    npm run bootstrap:ci

Help, plan, status and invalid invocations launch no install/build children and
change no checkout files, including without node_modules. Unknown, repeated or
conflicting flags fail before input reads or compiler probes. JSON is available
only for information modes; status exits 1 when readiness is incomplete.

The locked command reinspects current package declarations, the lock and actual
installed package manifests before selecting work:

| Actual state | Selected complete operation |
| --- | --- |
| Current readiness or intact recorded native/patch artifacts | Fresh native and patch verification |
| Locked package versions present; patch/native artifacts changed or unverified | Apply patches, targeted native repair, then verification |
| Missing packages, mismatched versions or unsupported lock inventory | Prerequisites, locked npm install, patches, native preparation and verification |
| Active/retained original owner or unsupported Node | Wait for that owner or select the supported runtime |

Recovery is metadata inspection, not native qualification or permission to skip
a stage recorded by an older run. New setup policy alone can be verified without
reinstalling unchanged packages. Missing allocation/identity information remains
an explicit blocker.

Explicit recovery uses the same owners:

    npm run bootstrap:ci -- --verify
    npm run bootstrap:ci -- --repair
    node tools/setup/rebuild-native.js --verify

Verify-only cannot install missing packages or apply missing patches. Repair
applies patches and uses existing targeted native repair. Bare npm run bootstrap
explicitly requests dependency resolution with npm install; the locked command
uses npm ci when installation is necessary. Both include development dependencies
and defer npm lifecycle scripts to their owned patch/native stages.

Checkout preparation targets this application's dependency tree. It does not
prepare another repository, download models or provision optional providers.
See [first search](first-search.md) for target readiness.

## Prerequisite and runtime verification

Each selected prerequisite command has one bounded 10-second discovery probe.
Timeout, launch failure and nonzero exit remain distinct. Explicit selections do
not silently change after failure.

Windows capability verification compiles and links a tiny C++20 program with the
selected compiler, MSBuild, target headers and libraries. It checks COFF/PE target
identity and records file hashes under .tmp/bootstrap-prerequisites/. It does
not execute that generated program. Original child teardown must settle before
scratch cleanup. Bounded contained reads release each compiler/header/library
input before reading later inputs.

Native verification performs real SQLite operations, parser activation, natural
and interrupted parser/VM worker teardown, Perl heredoc-state checks and the
mixed-consumer ONNX create/infer/dispose checks. Native setup also checks actual
locked package versions before work and again before qualification. Activation
and these bounded lifecycles do not qualify every language, model, platform or
representative workload. Keep ORT/Transformers parity under the
[runtime policy](node-runtime.md).

## Ownership, journal and readiness

Canonical bootstrap, direct native setup, patches and postinstall share one
original checkout mutation session. Nested operations borrow its opaque
capability; environment flags and serialized metadata cannot grant ownership.
Imports are inert. The existing subprocess/task owners handle cancellation,
actual child close, original resource observations and shutdown.
The complete journal startup/final publication scope is tracked by that original
mutation owner. Borrowers wait for durable startup, and finalization closes
admission before draining existing work.
Plan data and original IO methods/receivers are captured before asynchronous
admission, so later caller edits cannot change the selected operation.

Journal/native stream descriptors register with one original evidence-file group
before admission. Even a caller returning early cannot retire the checkout while
its actual descriptor remains open. The group captures at most 1024 owners and
retains independent persistence failures; unknown overriding open results remain
unconfirmed. Exact ordinary ancestors and file identity are checked around open.
Closing lifetime authority never deletes the retained artifact.
The same group preserves an original rejected child's retirement observer even
when the caller handles that rejection. Closed log files alone cannot release
the checkout while that actual child remains alive.

The root lock is .tmp/checkout-bootstrap/mutation.lock. Ordinary commands are
blocked while mutation or retained original work owns it. Age, PID death and
copied lock metadata cannot authorize stealing it. Original late resource
observations remain prerequisites throughout actual lock retirement.

One journal outside node_modules captures the ordered plan and actual stage
outcomes. Its internal bounds are 16 stages, 128 JSONL events, 256 KiB of journal
bytes and a 64 KiB plan. Exact descriptor writes, synchronization, close,
file identity/hash and status readback establish completed evidence. Unknown
write/close results retain the original owner and stop successor admission.

Before its first stage, the journal preserves an existing receipt's exact bytes
as .tmp/checkout-bootstrap/j-*/prior-readiness.json. Preservation is bounded to
8 MiB and records size/hash with historical-only status. Even malformed UTF-8
bytes survive node_modules replacement. A prior receipt never admits current work.

Readiness format **3** consumes an original single-use generation capture made
immediately before complete native probes. Publication rechecks setup hashes,
declared dependencies and admitted artifact metadata, then atomically writes and
reads back the exact receipt. It binds that generation to the same run and plan.

Normal entry requires the completed original journal, retired resources, exact
JSONL extent/hash and ordered stage frames. It rechecks receipt, journal and
mutation state after native inspection. Old formats, changed inputs and missing
or edited journal evidence require fresh verification. Artifact metadata is
distinct from native-content hashing; a marker or stage-success line is not
readiness.

Standalone verify-only patch inspection preserves the qualifying journal.
Patch preparation owns exact staging directories under
.tmp/checkout-bootstrap/patches/. Outstanding original child work blocks their
cleanup; diagnostic paths or copied directory identities grant no deletion
authority. Postinstall keeps one session through patch/native work and preserves
terminal status/signals after retirement. No patch inputs means no native step.

## Progress and diagnostic limits

The existing task owner emits version-1 in-process observations: queued,
dependency-wait, resource-wait, started, output-observed and actual terminal
states. Run/plan/task/attempt identities remain distinct. Resource-wait identifies
entry to admission, not proven contention. Timing separates dependency wait,
admission and execution; concurrent durations are not wall time.

Stable human transitions go to stderr, with bounded text and terminal controls
removed. Raw child bytes and existing JSON stdout remain separate. First-byte
observations report actual observed bytes and log paths, not persistence.
Asynchronous diagnostic callbacks drain under the original task reservation;
renderer failure cancels new admission while active owners settle.

Native probes now launch their actual bounded Node operations through that same
owner, without the former synchronous layer or extra per-package wrapper process.
SQLite promotion and ONNX import orders retain original callback failures;
uncertain native work cannot authorize rollback, fallback or another import
order. Existing parser/SQLite/ONNX content and disposal controls remain.

Raw compiler/probe streams are retained under
.tmp/checkout-bootstrap/logs/n-*/ with original command, status, hash and attempt
records. The original checkout owner admits at most 384 attempts and 32 MiB
aggregate storage including reserved metadata across every logger. Individual
loggers retain those same ceilings, with 8 MiB raw output per attempt. Original
writes reserve bytes before IO; only confirmed progress returns unused allowance.
Throwing or unknown writes keep their reservation. In-memory tails are
4 KiB per stream. Structured probe output uses a separate original, hash-checked
read bounded to 64 KiB; a truncated display tail cannot supply activation JSON.

Synchronization, original identity, close and metadata readback are required for
complete logs. Evidence loss and unknown publication stop fallback/readiness
while preserving independent compiler and cleanup failures. Failed prebuilds
remain distinct when a later source build succeeds. Cross-run retention remains
implementation work.

## Qualification scope

The new session, journal, recovery, logging and asynchronous-probe controls are
authored and locally **UNRUN** in this development wave. Formatting and generated
inventories do not establish runtime qualification. Windows terminal transport,
cross-process lifecycle cases and measured serial/bounded bootstrap work still
need their affected checks. No measured speedup follows from removing a wrapper
or adding progress output.
