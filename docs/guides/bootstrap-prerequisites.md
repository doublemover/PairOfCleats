# Source checkout prerequisites

Install **Node >=26.12.1 <27**, preferably the exact `.nvmrc` version, npm and
Git. Python 3 and supported C/C++ build tools are mandatory for every full
bootstrap, including the low-resource sparse-search path. The patched required
Perl parser is always rebuilt from source; other available prebuilts do not
remove that requirement. Python must satisfy node-gyp (currently >=3.6); use a
currently maintained Python 3 release. Python 3.12+ needs node-gyp >=10; the lock
includes node-gyp 13.1.0.

CI and release native builds select **Python 3.15.2** from `.python-version`
through `actions/setup-python`, then bind preflight/node-gyp to that action's
exact interpreter. Local bootstrap still accepts a compatible maintained Python;
select the pinned version explicitly with `NODE_GYP_FORCE_PYTHON` when installed
alongside another interpreter. Runtime Python commands use the selected PATH.

Prerequisite discovery gives each selected command one bounded10-second probe.
Cold interpreter/tool startup receives the same allowance as a warm launch.
Timeout, launch failure and nonzero exit are reported separately; explicitly
selected interpreters retain their selection and have no ambient fallback.
Native build/activation and runtime qualification follow successful discovery.
Ordinary test capsules retain their separate30-second limits and zero retries.

The existing bounded task scheduler preserves original compiler failures,
including non-Error rejections. Result callbacks receive fixed outcome records;
their asynchronous work must settle before completion. Callback failures remain
distinct from compiler outcomes and cancel further admission while already
running owners drain. Diagnostic accessors are not invoked to classify failures.
The added failure/observer regressions await execution; this is not a native
readiness or complete bootstrap qualification.
Native build and activation-probe failures use the original storage-observation
owner before projecting diagnostics. Unsettled children and actual cancellation
escape the ordinary failed-result path, so they cannot trigger a fallback build
or successor probe. A settled compiler with truncated output has a separate
terminal transcript error retaining its actual compiler status and original
captured bytes. Four added controls await execution.
Pending original retirement is terminal for admission even during optional or
collect-all verification. Already running owners drain; queued successors are
cancelled. Ordinary settled package failures retain their existing collect-all
behavior.

## Windows

Install [Python 3](https://www.python.org/downloads/windows/),
[Git for Windows](https://git-scm.com/download/win), and Visual Studio 2022/2026
or its [Build Tools](https://visualstudio.microsoft.com/downloads/).
In Visual Studio Installer select **Desktop development with C++**, MSVC tools
for your target (x64 or ARM64), MSBuild and a **Windows 11 SDK**. This is a user
setup step. The reviewed [Windows prerequisite repair](windows-prerequisite-repair.md)
source path plans an exact Build Tools install/modify separately; ordinary
bootstrap does not install machine tools or alter security settings.
Keep any explicitly selected Visual Studio/Python environment consistent with
the installed tools. A normal terminal need not already have `cl` on PATH:
discovery uses registered Visual Studio installations and installed SDK files.

## Linux

Install Python 3, GNU Make, Git and a compiler supported by Node 26 headers.
For example, on a Debian/Ubuntu release that provides GCC 13:

```sh
sudo apt-get install git python3 make gcc-13 g++-13
```

Ensure the selected compiler is available to node-gyp, for example
`CC=gcc-13 CXX=g++-13 npm run bootstrap:ci` when using those versioned commands.
Use your distribution's equivalent packages for other systems. The
[Node 26 build table](https://github.com/nodejs/node/blob/v26.12.1/BUILDING.md#supported-toolchains)
documents supported compiler families/versions; building Node itself has
additional requirements beyond this checkout's native addons.

## macOS

Install Python 3 and the Xcode Command Line Tools supported by Node 26. The tools
provide Clang, Make and Git:

```sh
xcode-select --install
```

See [node-gyp installation prerequisites](https://github.com/nodejs/node-gyp#installation)
and the Node toolchain table for current platform details. Python should be
discoverable as `python3`/`python`, through the Windows `py -3` launcher, or an
existing node-gyp Python selection.

## Check, install, verify

Python selection follows `NODE_GYP_FORCE_PYTHON`, `npm_config_python`, `PYTHON`,
then the Windows `py -3` launcher and PATH candidates. An invalid highest-priority
explicit Python selection fails with its source; it never falls through to a
different installation. Launcher/PATH discovery accepts stable Python releases.
Using an alpha/beta/release candidate requires an explicit interpreter override
and is reported as an opt-in, with qualification still required. VS selection respects
`VCINSTALLDIR`, `npm_config_msvs_version` and `GYP_MSVS_VERSION`; POSIX respects
explicit `CC` and `CXX`. Preflight reports the selected executable/version/source, MSVC,
MSBuild, target architecture and Windows SDK. Its qualified child-local selection
is rediscovered and carried by the native rebuild owner; it does not modify
global PATH, Python associations or machine defaults. Discovery alone does not
prove which nested package compiler ran or qualify every modern stable toolchain.
The npm version/path fields describe npm's launch environment when supplied;
they do not claim an npm executable was activated by diagnosis.

From the checkout root, `node tools/setup/preflight.js` performs a bounded,
dependency-free prerequisite check. The canonical npm commands now use one
strict dependency-free entry. `npm run bootstrap:ci -- --help`, `--plan` and
`--status` launch no child or mutation; append `--json` for their machine reports.
Unknown options, repeated options and conflicting modes fail before input reads
or prerequisite probes. `--verify` selects the existing native/patch verifier;
`--repair` applies required patches and selects targeted native repair. A locked
repeat with intact readiness verifies without reinstalling. `npm run bootstrap`
still explicitly requests dependency resolution, even in a prepared checkout.

Normal `npm run bootstrap:ci` (locked install) and `npm run bootstrap`
(intentional dependency resolution) run preflight before npm downloads/replaces
dependencies. Stages stop at the original failure or cancellation, with actual
child settlement managed by the existing command owner. Checkout preparation
always targets the application checkout, separately from target provisioning.
The six added entry regressions await execution. Readiness format 2 requires an
original single-use generation capture taken immediately before the complete
native probes. Publication rechecks setup hashes, declared dependencies and the
entire admitted artifact metadata inventory; changed inputs or native artifacts
preserve the prior receipt and require fresh verification. Obsolete receipt
formats are rejected. Artifact metadata remains distinct from content hashing.
Four added generation regressions await execution.
The native entry now exposes its same implementation as an inert imported
operation, without exiting its caller. The checkout transaction can reuse that
owner in-process; no environment-based readiness or ownership bypass is added.
Invocation cancellation reaches native build/probe schedulers, patch verification
and child commands. Mode and invocation context are captured before asynchronous
admission; changing caller containers cannot turn verification into a rebuild.
Three import/admission controls await execution.

The canonical checkout coordinator and direct native entry now share one original
file-lock session spanning their actual work. Nested operations require its
root-qualified opaque capability and are drained before retirement. Ordinary
entry readiness is blocked while that mutation or retained original work exists.
Age and PID death never reclaim the record. Exact original release can be retried
only through its retained owner after physical prerequisites settle. Setup input
drift stops successor stages; explicit dependency resolution alone admits its
intended lockfile change. Five session controls await execution. Direct patch and
postinstall admission, durable stage journals and cross-process qualification
remain the next #1555 work.
Unsupported Node or missing Git/Python/build
tools stop immediately with a prerequisite error. Windows discovers the target
compiler, MSBuild and SDK, then the direct preflight entry compiles and links a
tiny C++20 program using those selected C++/Windows/UCRT headers and target
libraries. It checks the resulting COFF and PE machine target and records actual
file hashes in run-owned `.tmp/bootstrap-prerequisites/` evidence. Unconfirmed
child teardown retains scratch ownership. It does not run the resulting
executable. POSIX checks Make and a C++ command. These checks do not compile all
native modules or qualify every custom compiler configuration. The new Windows
capability/repair source is **UNVALIDATED** in this development batch; authored
fake-child regressions have not been executed.

The explicit prerequisite plan/apply front door shares its CLI cancellation
signal with bounded contained input reads, installer signature inspection,
target discovery, vendor execution and capability verification. Interrupted
inspection stops before the next native probe and preserves `130`/`143` in the
terminal JSON result. A vendor exit of zero still needs exact post-install
Windows instance/architecture discovery and the canonical successful compiler
capability receipt. Missing discovery fields or an unqualified capability
result cannot become verified prerequisites. This path still honors declared
allocation blockers and never records application bootstrap readiness.

Compiler capability evidence uses one bounded contained file read at a time for
the compiler, linker, headers and libraries in both identity passes. Receipts
retain file hashes and metadata; they do not hold complete native inputs while
reading every later input. Output bytes are used for their COFF/PE target check
and then released from retained results. This is an authored ownership bound,
not a measured memory or bootstrap speed claim, and remains **UNVALIDATED**.

After discovery, locked bootstrap installs development dependencies, applies
patches, builds required native sources and verifies packages/language routes
before recording readiness. A preflight pass alone never records readiness.
Verification includes real parser workers exiting naturally and during interrupted
parse work, plus literal Perl heredoc state checks. These bounded operations
supplement activation evidence; they do not qualify every language, runtime
lifecycle, platform or representative workload.
Prepared installations can refresh verification using
`node tools/setup/rebuild-native.js --verify`; that cannot install missing
packages or repair missing patches. See the [runtime policy](node-runtime.md).
