# Source checkout prerequisites

Install **Node >=26.12.1 <27**, preferably the exact `.nvmrc` version, npm and
Git. Python 3 and supported C/C++ build tools are mandatory for every full
bootstrap, including the low-resource sparse-search path. The patched required
Perl parser is always rebuilt from source; other available prebuilts do not
remove that requirement. Python must satisfy node-gyp (currently >=3.6); use a
currently maintained Python 3 release. Python 3.12+ needs node-gyp >=10; the lock
includes node-gyp 13.1.0.

## Windows

Install [Python 3](https://www.python.org/downloads/windows/),
[Git for Windows](https://git-scm.com/download/win), and Visual Studio 2022/2026
or its [Build Tools](https://visualstudio.microsoft.com/downloads/).
In Visual Studio Installer select **Desktop development with C++**, MSVC tools
for your target (x64 or ARM64), MSBuild and a **Windows 11 SDK**. This is a user
setup step; bootstrap does not alter security settings or install machine tools.
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
then the Windows `py -3` launcher and PATH candidates. VS selection respects
`VCINSTALLDIR`, `npm_config_msvs_version` and `GYP_MSVS_VERSION`; POSIX respects
explicit `CXX`. Preflight reports the selected executable/version/source, MSVC,
MSBuild, target architecture and Windows SDK. Its qualified child-local selection
is rediscovered and carried by the native rebuild owner; it does not modify
global PATH, Python associations or machine defaults. Discovery alone does not
prove which nested package compiler ran or qualify every modern stable toolchain.

From the checkout root, `node tools/setup/preflight.js` performs a bounded,
dependency-free prerequisite check. Both `npm run bootstrap:ci` (locked install)
and `npm run bootstrap` (intentional dependency resolution) run it before npm
downloads/replaces dependencies. Unsupported Node or missing Git/Python/build
tools stop immediately with a prerequisite error. Windows checks target compiler,
MSBuild and SDK files; POSIX checks Make and a C++ command. These discovery probes
do not compile all native modules or qualify every custom compiler configuration.

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
