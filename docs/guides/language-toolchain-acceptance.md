# Individual language-toolchain acceptance

Date: 2026-10-03
Scope: small local fixtures, not release-wide or full-index acceptance

The canonical queue remains [the roadmap](../roadmap.md). These records explain
adopted compatibility changes and their acceptance boundary. An installed package
or parser fixture does not establish LSP, compiler or whole-project correctness.
Preserve the [execution authority rules](execution-authority.md) during trials.

## C# native grammar

The pinned `tree-sitter-c-sharp` version is updated from 0.23.1 to 0.23.5.
The [official registry metadata](https://registry.npmjs.org/tree-sitter-c-sharp/0.23.5)
declares a `tree-sitter` 0.25 peer and uses the grammar's own `node-gyp-build`
loader. This aligns the peer with the existing locked runtime, 0.25.0, without
changing that runtime or removing its C++20 source-build patch.

The new vendor JavaScript wrapper uses top-level await around a synchronous
native binding. PoC loads that binding through the installed grammar's declared
loader and attaches its node-type metadata. This preserves synchronous parser,
preflight and chunking APIs. Resolution stays anchored to installed application
dependencies. A repository's local module directory is not a grammar source.

Linux x64, Node 24 validation used the exact locked runtime 0.25.0, rebuilt with
the existing patch, and grammar 0.23.5. Native preflight, a class/method chunking
fixture, complete UTF-16 source extent and malformed-input recovery passed.
An earlier 0.25.1 runtime fixture also passed. Neither result proves Windows,
macOS, a C# compiler build, a full index or a C# language-server session. Optional
vendor query-file exports are not loaded; PoC generates its own chunk queries.

## Groovy native grammar and relations

The current and latest checked `tree-sitter-groovy` version is 0.1.2.
The registered native route remains usable for declaration chunks, with partial
grammar coverage. The [upstream grammar](https://github.com/amaanq/tree-sitter-groovy/blob/master/grammar.js)
requires a delimiter on return statements. A compact fixture without a trailing
semicolon before a closing brace produces a recovery node; its semicolon control
does not. Groovy permits optional semicolons, as described in its
[official style guide](https://docs.groovy-lang.org/latest/html/documentation/style-guide.html).
Parser recovery alone cannot establish that a Groovy source file is invalid.

Groovy native chunks carry `meta.parserCoverage: "partial"` and
`meta.parserRecovered: true`, `false` or `null`. The boolean reflects the observed
root recovery flag; `null` means it was not observed, including a legacy cached
chunk. Query, traversal, whole-file and cache paths preserve the coverage label.
Useful recovered class/method chunks remain available. Strict mode still means
the native route's fallback policy, not complete grammar conformance.

The Groovy relation adapter separately reports a partial capability profile with
the existing `USR-R-HEURISTIC-ONLY` diagnostic. It collects imports and heuristic
relations; native declaration chunking does not turn those into compiler-derived
semantic relations. No vendor grammar fork, Groovy compiler or Groovy LSP was
installed for this change.

## Focused regression and resource boundary

Run the affected C#/Groovy fixture with installed native dependencies:

```sh
node tests/indexing/tree-sitter/csharp-groovy-coverage.test.js
```

Trials run serially with one CPU, a 512 MiB Node heap, a 768 MiB sampled process-tree
RSS stopping rule and 2 GiB available-RAM reserve. Tests are bounded to 30 seconds;
installation or compilation steps are separately bounded to 180 seconds. Embeddings
are off and model access is offline. The locked-runtime rebuild completed in about
25 seconds, with sampled process-tree RSS below 448 MiB. Native syntax and chunking
checks complete in under a second. These are resource observations, not benchmarks.

### Node-hosted language servers

The next serial batch accepted these exact installed versions through PoC's real
stdio/JSON-RPC client on freshly generated inert fixtures:

| Server | Routing | Accepted behavior | Not established |
| --- | --- | --- | --- |
| YAML language server 1.24.0 | Supported auto preset | Initialize, mapping document symbols and duplicate-key diagnostics; common collector retains the diagnostic with schema/CRD stores disabled | External schemas, complete orchestrator pipeline, full indexing |
| TypeScript language server 6.0.1 with TypeScript 5.9.3 | Explicit generic LSP; not the default in-process TypeScript provider | Initialize, symbols, hover, same-file definition; server confirms the explicit compiler version | TS7 native migration, projects/plugins, full provider pipeline |
| Bash language server 5.8.1 | Explicit generic LSP; not an auto preset | Initialize, function symbols, hover, same-file definition; background scanning disabled | ShellCheck/shfmt, external sourced files, shell execution, full provider pipeline |

The YAML and shell extension fallback now supplies `yaml` and `shellscript`
instead of `plaintext` when a document has no explicit language ID. The YAML
auto preset disables both schema-catalog and Kubernetes CRD-store fetching.
The managed TypeScript LSP install plan includes the package's compatible compiler
range alongside the wrapper; installing only the wrapper does not provide tsserver.
These changes preserve launch-owned configuration and installed-tool authority.

The current YAML server pulls `workspace/configuration` instead of applying the
initialize payload's settings directly. The common collector now advertises and
answers that request only from explicitly configured settings. It uses bounded
section lookups, ignores server-supplied scope URIs and reads no workspace files.
Pooled-session identity already includes those initialization options.

A real collector fixture also reproduced lost diagnostics: the document was
closed after document-symbol collection, canceling the server's debounced
validation. Diagnostic-enabled passes now retain their owned documents through
an event-driven drain and shaping, then close them on success/failure/abort.
The drain has one shared 500 ms budget, bounded URI tracking and remaining-deadline
handling; empty notifications count as observations. Runtime counts distinguish
observed from pending notifications. A missing or timed-out notification does
not prove a clean source file. Synthetic delayed-notification, cleanup, settings
and abort-boundary regressions cover the change.

Primary version and behavior references:
[YAML metadata](https://registry.npmjs.org/yaml-language-server/1.24.0) and
[upstream settings](https://github.com/redhat-developer/yaml-language-server),
[TypeScript LSP metadata](https://registry.npmjs.org/typescript-language-server/6.0.1) and
[upstream compiler/launch contract](https://github.com/typescript-language-server/typescript-language-server),
[Bash metadata](https://registry.npmjs.org/bash-language-server/5.8.1) and
[upstream optional lint/format tools](https://github.com/bash-lsp/bash-language-server).

The opt-in acceptance harness installs nothing, starts exactly one supplied
server, creates its own temporary fixture/home, excludes credentials from the
server environment, and closes/kills the client before removing that fixture:

```sh
node tests/tooling/lsp/live-server-smoke.mjs yaml-language-server /absolute/install/node_modules
node tests/tooling/lsp/live-server-smoke.mjs typescript-language-server /absolute/install/node_modules
node tests/tooling/lsp/live-server-smoke.mjs bash-language-server /absolute/install/node_modules
node tests/tooling/lsp/live-server-smoke.mjs yaml-language-server /absolute/install/node_modules --collector
```

Run only the chosen server with the same outer resource limits below. The
TypeScript installation must also contain a classic TypeScript package. This
harness is opt-in and is not selected by the automatic test lanes. The small locked
`smol-toml` dependency was subsequently installed in the isolated setup: preset
configuration and selected Rust workspace integration fixtures now pass. These
synthetic checks and direct client acceptance do not establish full-orchestrator
or release-wide acceptance.

### Rust workspace authority prerequisite

Before a live Rust server trial, PoC now requires the launch-owned exact repository
grant described in the [execution-authority guide](execution-authority.md). Official
[rust-analyzer security guidance](https://rust-analyzer.github.io/book/security.html)
states that workspace analysis may execute project build machinery. Server
installation alone does not authorize that execution. The denial regression uses
only a benign protocol stub and native AST input, checks preflight/probe/runtime
entry points and pending trust changes, and confirms that untrusted native Rust
AST chunking still works. That initial guard regression alone does not establish
live Rust server/compiler acceptance; the subsequent live record is separate.
Ten affected Rust workspace/proc-macro synthetic fixtures and the generic preset,
mixed routing/signature and runtime-requirement compatibility checks pass. Three
other Rust fixtures initially failed in negative-cache reuse, partial partition
coverage and timeout-local cache classification. The same assertions failed against
preceding published source with the same explicit benign-fixture grant, so the
failures were preserved rather than attributed to the new execution gate.

The subsequent connected correction identified a shared assembly bug: an earlier
missing-runtime warning masked later Rust metadata blocks, partition exclusions
and cache reuse. Preflight selection now prioritizes denial, then partial coverage,
then ordinary degradation; it merges excluded keys/roots and preserves explicit
workspace-cache participation. All warnings remain visible. The three original
behavioral assertions now pass unchanged, including healthy-partition continuation
and negative-cache isolation between slow and healthy roots. A pure precedence/
aggregation fixture pins the rule without requiring a SDK or real project build.

### Rust and Zig build-capable servers

The next Linux x64 fixture uses official Rust stable-channel components dated
2026-10-01. The actual binaries report rustc and rust-analyzer 1.99.0 (2026-09-28);
the manifest's analyzer package version `0.0.0` is not substituted for that binary
identity. Rustc, Cargo, std, source and analyzer archives each matched their official
channel SHA-256 before bounded staged extraction. No global rustup/toolchain or
system PATH change was made. The project's separate native-TUI compiler pin is
unchanged by this isolated language-server trial.

ZLS latest stable is 0.16.0. Zig's latest stable is 0.17.0, but the official
[compatibility policy](https://zigtools.org/zls/install/) requires matching minor
versions. The trial therefore uses official Zig 0.16.0 with ZLS 0.16.0, rather than
pairing an incompatible latest compiler. Zig is a tooling-only preset in PoC's
current registry; a successful explicitly supplied LSP document does not add a
registered parser/native AST route.

| Tool | Accepted through actual PoC client and common collector | Fixture boundary |
| --- | --- | --- |
| rust-analyzer 1.99.0 / Rust 1.99.0 | Initialization, document symbols, hover, same-file definition and chunk binding | Dependency-free crate; offline Cargo, build scripts/proc macros/check-on-save disabled; exact owned fixture grant |
| ZLS 0.16.0 / Zig 0.16.0 | Initialization, document symbols, hover, same-file definition and chunk binding | Standalone Zig file without build.zig; launch-owned external config, build-on-save and child-process AST checking disabled; exact owned fixture grant |

Both modes first verify denial without a repository grant, then explicitly grant
only the generated canonical fixture root. They use an isolated environment/home
without account credentials. A grant is still required for ZLS package/include
resolution because its [build runner executes build.zig](https://github.com/zigtools/zls/blob/0.16.0/src/DocumentStore.zig);
disabling only build-on-save is insufficient. The denial and pending-grant-change
regressions use a benign protocol stub and never run a project build script.

The reproducible opt-in harness installs nothing, runs one supplied verified tool,
restores the launch environment, and shuts down/kills both owned clients before
removing its own fixture. It accepts the protocol's single-Location and array
definition shapes; the initial ZLS harness assertion was corrected for its valid
single-Location response, not by weakening source containment.

```sh
node tests/tooling/lsp/live-build-server-smoke.mjs rust-analyzer /absolute/rust-sdk/bin/rust-analyzer /absolute/rust-sdk
node tests/tooling/lsp/live-build-server-smoke.mjs zls /absolute/zls /absolute/zig-0.16.0-root
```

Source archive SHA-256 values:

- Rustc: `77171ba2a0345fdf2abc4fedda55d6de078dae7a68527c28be8c77dcc9604bd5`
- Cargo: `d7674918d28093097614cd9728b6ca60db9ea3038f640f0bd1e9a4188c7568ce`
- Rust std: `3e58dff2d0b72196b5ea4e90536e174d400de88564a52694686b81e091169933`
- Rust source: `3f1f9b7ed48f4596fc87889b7b3c61747336a55c9c22db1ab0c697e0aadb77aa`
- Rust analyzer: `52dfae764797c3c7f32ba2ba82d49659741a867e7a3f45bc3291b822c955d6a8`
- Zig 0.16.0: `70e49664a74374b48b51e6f3fdfbf437f6395d42509050588bd49abe52ba3d00`
- ZLS 0.16.0: `ded6d562a0b86ee878b1ddf70ffab2797ce3cdca3b02d6077548f9d56dff96b6`

Primary provenance: [Rust stable manifest](https://static.rust-lang.org/dist/channel-rust-stable.toml),
[Zig download metadata](https://ziglang.org/download/index.json),
[ZLS release](https://github.com/zigtools/zls/releases/tag/0.16.0).
Representative Rust fixtures completed in about 1.5 seconds with sampled
process-tree RSS around 430–530 MiB; ZLS completed below a second and 128 MiB.
The 768 MiB sampled stopping rule remains the trial bound, not a promised fixed
per-server footprint. One cold-readiness request exceeded the harness's original
1.5-second request timeout; its bounded request allowance is now four seconds
inside the unchanged 30-second outer fixture deadline. Project runtime budgets
are unchanged. ZLS's initial archive
connection timed out before download and its bounded ordinary retry succeeded.
These remain small common-client/collector checks, not full configured-orchestrator,
compiler conformance, arbitrary workspace/build execution, full-index or platform
acceptance. No dependencies, embeddings or models were downloaded by the fixtures.

### Native and Go-SDK servers

The next isolated Linux x64 batch used official, checksum-verified portable
distributions and source modules. No system compiler installation or PATH change
was made. The existing `/usr/bin/go` was not the Go programming-language compiler;
the fixture uses its explicitly selected SDK instead of relying on that name.

| Tool | Exact selection | Accepted behavior | Boundary |
| --- | --- | --- | --- |
| LuaLS | 3.19.1, official Linux x64 asset | Auto-preset command through the actual client; initialize, symbols, hover, same-file definition | No plugin approval/execution, third-party detection, compiler execution or other-platform acceptance |
| gopls | v0.23.0, built with portable Go 1.27.1 | Auto-preset command; initialize, symbols, hover, same-file definition on one dependency-free Go module | No project builds, external module resolution, vulnerability scan or full collector/orchestrator acceptance |
| sqls | v0.2.48, built with Go 1.27.1 and CGO enabled | Initialize, SQL formatting and keyword completion without a database | No database/schema/query acceptance; advertised capabilities omit document symbols, so the current type collector's symbol gate is not satisfied |

The LuaLS archive SHA-256 is
`e9235d2d72ef55bc41cf8c99cda2ed64777682024b4bb81f5dea425060c5cbb8`.
The Go 1.27.1 Linux amd64 archive SHA-256 is
`63d339f0da5ab53635a56f2490a7984dfe12dfcff22ad749f63edaf590168445`.
Both matched the official release metadata before bounded, staged extraction.
Go module installation used the normal checksum database, exact module versions,
one build job, a 384 MiB Go memory target and the same outer RSS/time envelope.
gopls built in about 144 seconds with sampled process-tree RSS below 536 MiB.
The initial CGO-disabled sqls attempt failed in godror; the compatible CGO-enabled
build completed in about 124 seconds below 480 MiB. No Oracle client was installed
and no database connection was configured or opened.

The Lua fixture uses a launch-owned JSON configuration outside the synthetic
workspace: 16 preloaded files, 64 KiB preload file size, no third-party detection,
plugins or telemetry. Unsupported interactive approval requests receive no
approval. The Go fixture uses `GOMAXPROCS=1`, a 256 MiB Go memory target,
`GOTOOLCHAIN=local`, offline module resolution and no vulnerability checking.
Telemetry configuration and caches live only in the generated fixture home.
SQLs receives an explicit empty connection configuration. SQL extension fallback
now supplies its proper LSP language ID.

The opt-in SDK harness prints the actual executable version and SHA-256, installs
nothing, and runs only the chosen tool. Verify its official source separately:

```sh
node tests/tooling/lsp/live-sdk-server-smoke.mjs lua-language-server /absolute/luals/bin/lua-language-server
node tests/tooling/lsp/live-sdk-server-smoke.mjs gopls /absolute/bin/gopls /absolute/go-sdk/go
node tests/tooling/lsp/live-sdk-server-smoke.mjs sqls /absolute/bin/sqls
```

Primary references:
[LuaLS release](https://github.com/LuaLS/lua-language-server/releases/tag/3.19.1),
[LuaLS configuration/CLI](https://luals.github.io/wiki/usage/),
[Go distributions and hashes](https://go.dev/dl/),
[gopls v0.23.0](https://pkg.go.dev/golang.org/x/tools/gopls@v0.23.0),
[gopls settings](https://go.dev/gopls/settings), and
[sqls v0.2.48 source](https://github.com/sqls-server/sqls/tree/v0.2.48).
SQLs' upstream still describes its interface as under development; a version tag
does not establish a stable interface or complete PoC enrichment compatibility.

## Python alternatives and current adapter comparison

Current official metadata identifies Pyright 1.1.414, ty 0.0.84 and Ruff 0.16.10.
The project still declares `pyright ^1.1.408` and locks 1.1.408; the newer server is
an isolated comparison installation, not an unreviewed default replacement. ty
and Ruff are optional candidates, not added declared dependencies or auto presets.

| Tool | Tiny actual-client result | PoC integration boundary |
| --- | --- | --- |
| Pyright 1.1.414 | Symbols, hover, same-file definition, invalid-assignment and undefined-name diagnostics | Actual dedicated adapter and common collector with the Python signature callback return the expected int type and two diagnostics |
| ty 0.0.84 | Symbols, hover, same-file definition, invalid-assignment and unresolved-reference diagnostics | Common collector with Python signature callback returns the expected int type and two diagnostics; explicit untrusted-workspace mode, uv off |
| Ruff 0.16.10 | Undefined-name lint diagnostic and formatting | No documentSymbol/navigation advertised; explicit diagnostics-only mode binds its diagnostic through common collection and configured-provider execution, without type chunks |

The first direct generic Pyright comparison omitted the language-specific signature
callback and returned diagnostics but no type chunks. The actual dedicated adapter
already supplies that callback. Its real-server pass confirms that the omission was
in the comparison harness, not evidence of a broken default Pyright adapter.

ty is a maintained Rust-based Python type/navigation candidate. Its documented
`untrustedWorkspace: true` initialization option disables external commands;
the fixture additionally uses `experimental.useUv: "off"`, open-files-only
diagnostics and no auto imports. This is an explicit safe-mode trial, not proof that
arbitrary ty configurations or Python projects are safe. The evolving 0.0.x line
still needs broader type/library/diagnostic compatibility evaluation before any
default replacement. No upstream speed claim is adopted from marketing or these
unequal fixture modes.

Ruff's maintained native `ruff server` replaces its archived Python `ruff-lsp`.
Upstream positions it alongside a type/navigation server, not as its replacement.
Its real advertised capability boundary is retained; no symbols, navigation or
type semantics are invented to satisfy the current collector gate.

The initial comparison reproduced that the type-oriented collector skipped even
Ruff diagnostics. The connected correction adds explicit diagnostics-only mode:
configured `kinds: ["diagnostics"]` turns type collection off, while direct common
calls can set `collectTypes: false` with diagnostic capture. The ordinary type-mode
capability gate remains unchanged. Both modes share owned URI/version/open/close
handling; present-version mismatches and unowned URI notifications are rejected,
while legacy unversioned diagnostics for opened files remain supported. The new
deterministic fixture covers file/VFS binding, no type requests, single close,
configured fidelity and abort cleanup. Actual Ruff now contributes one bound
F821 diagnostic and no type/navigation payload; ty also passes its manually
configured generic provider. Pyright remains the dedicated default.

Official Linux x64 wheels were installed separately, dependency-free, with pip's
mandatory SHA-256 verification and no source build:

- ty: `af17eb391ae3027fed9be1780bea555c2b8a25ba68e184c627b4981b2c9eaab7`
- Ruff: `f33f43a864a8483eebd160e713336c8bab02c934feaff0a33cf5ccb41546d09a`

Each mode uses one generated Python file, an isolated credential-free home/env,
the actual PoC stdio client, explicit pool cleanup and the same 30-second outer
deadline. The source file is parsed/analyzed, never executed. No project environment,
dependency, embedding or model is installed by the harness, which installs nothing:

```sh
node tests/tooling/lsp/live-python-server-smoke.mjs pyright /absolute/install/node_modules
node tests/tooling/lsp/live-python-server-smoke.mjs ty /absolute/verified/ty
node tests/tooling/lsp/live-python-server-smoke.mjs ruff /absolute/verified/ruff
```

Primary sources: [Pyright metadata](https://registry.npmjs.org/pyright/1.1.414),
[ty package metadata](https://pypi.org/pypi/ty/0.0.84/json),
[Ruff package metadata](https://pypi.org/pypi/ruff/0.16.10/json),
[ty language-server capabilities](https://docs.astral.sh/ty/features/language-server/),
[ty trust and initialization controls](https://docs.astral.sh/ty/reference/editor-settings/),
and [Ruff's complementary server contract](https://docs.astral.sh/ruff/editors/).
These tests are small Linux fixtures, not a comparative benchmark, broad Python
index, full type-checker conformance, orchestrator or cross-platform acceptance.

## C and C++ with current clangd

Official clangd 23.1.0 accepts separate tiny C17 and C++20 files through the actual
PoC client, common collector and existing dedicated clangd adapter: document
symbols, hover, same-file definition and the expected int return type. The package
is isolated in task storage, not added to system PATH or automatically installed.

The official Linux archive is 117,949,007 bytes, with published SHA-256
`e53b1a96196095faedb7642cf64964f7fb9ad4a0c1f00dd2c172a3d9dcbafdfd`.
It matched before bounded staged ZIP extraction: 437 entries and about 235 MB
unpacked. The install completed within 15 seconds below 23 MiB sampled RSS; tiny
runtime fixtures completed within five seconds below 256 MiB sampled process-tree RSS.
These observations are not a comparative benchmark or a footprint guarantee.

The fixture supplies its own fixed compilation database outside the workspace,
uses one clangd job, and disables background indexing, clang-tidy, project/global
configuration and compiler-driver queries. Its credential-free home/environment
has no ambient CLANGD_FLAGS. No C/C++ executable is built or run. Exact-version
LLVM source clears frontend plugin lists; the official command documentation also
describes the explicit query-driver allowlist. This is not blanket acceptance of
arbitrary compile databases, plugins, cross-compilers or workspace builds.

An initial common-call harness passed its language ID in the signature helper's
symbol-name slot and obtained an incorrect return-type string. The corrected
callback and actual dedicated adapter both pass; the dedicated adapter already
supplies the correct callback. No production parser change was needed.

```sh
node tests/tooling/lsp/live-clangd-server-smoke.mjs c /absolute/verified/clangd
node tests/tooling/lsp/live-clangd-server-smoke.mjs cpp /absolute/verified/clangd
```

The harness installs nothing and cleans its owned clients/pool/temporary files.
Objective-C/C++ acceptance is separate: the dedicated adapter includes .m/.mm
only on macOS, and these Linux fixtures do not establish Apple SDK coverage.
Primary sources: [official release](https://github.com/clangd/clangd/releases/tag/23.1.0),
[command/driver policy](https://clangd.llvm.org/design/compile-commands),
[configuration](https://clangd.llvm.org/config), and
[exact-version plugin handling](https://github.com/llvm/llvm-project/blob/llvmorg-23.1.0/clang-tools-extra/clangd/Compiler.cpp).

## Java/JDT workspace authority prerequisite

JDT LS 1.61.0 is the latest stable milestone listed by the
[official Eclipse download area](https://download.eclipse.org/jdtls/milestones/).
Its 51,037,522-byte archive matched the published SHA-256
`338e7e73d61836651ba2453919a0d34fa763eb4e7c03342092309bffb8934c64`
before bounded staging (141 entries, about 55 MB unpacked). This admission used
about six seconds and below 21 MiB sampled RSS. Admission alone is not live-server
or Java SDK acceptance.

Before any workspace-capable Java launch, the existing exact launch-owned grant
now covers JDT/custom Java providers, probes, dedicated bootstrap/cache identity,
direct collection and pending trust changes. Native Java class/method AST parsing
remains available without that grant. The synthetic authority fixture rejects
before workspace/cache creation or client startup, preserves canonical nested-root
checks, and verifies cleanup when trust is revoked during awaited preparation.
Positive compatibility fixtures explicitly grant only their owned temporary root.
The [authority guide](execution-authority.md) links the exact JDT defaults/import
source, including Gradle synchronization and annotation-processing settings.

Selected dedicated bootstrap, workspace/launch guards, fallback, multifile reuse,
failure/abort cleanup and doctor runtime/handshake fixtures pass. The broader
command-profile matrix still fails its unrelated default-Pyright probe assertion;
the identical assertion fails against preceding head 102e61cc with the same narrow
fixture grants. This boundary is preserved rather than weakening that assertion.
An earlier repository formatter reached its 30-second cutoff; the changed
JavaScript files passed focused formatting and the subsequent signature batch's
full formatter passed. No arbitrary project import/build,
embedding, model or CI run is part of these checks.

### Bounded live JDT and signature follow-through

The SHA-verified JDT LS 1.61.0 server runs with this cloud image's existing
OpenJDK 21.0.12.1 Debian runtime. Its observed Java executable digest is
`6698f6f10143ed8463b06062281c727152d2e0ae2a3569b1716fbb2c6cedf0ba`;
this identifies the preinstalled executable, not a newly verified SDK archive.
The image lacks the `javac` launcher, so the dedicated provider retains its
`jdtls_runtime_javac_missing` degradation warning. Full JDK/compiler acceptance
is not established.

A plain owned App.java file with no build markers/dependencies accepts actual
PoC-client initialization, hierarchical symbols, Java hover and same-file
definition. The observed `int App.add(int a, int b)` hover parses to int with both
named parameter types. Common and dedicated collection bind the correctly scoped
method chunk and return the expected type, with explicit heuristic source-bootstrap
provenance. Those collection modes do not claim that their type came from a server
hover or a complete compiler project model. The raw-client hover check is separate.

The live trial reproduced a real signature mismatch: JDT's symbol identity
`App.add(int, int)` was included in the C-like return-type comparison, yielding
`int add`. The Java-specific parser now normalizes the owner/parameter suffix and
Java modifiers for dedicated and generic Java routes. Qualified return-type names
remain intact, constructor returns are not invented, and return-type-only symbol
detail does not fabricate a complete signature. Pure signature fixtures and a
deterministic JDT-style dedicated-provider fixture cover these cases. This is not
a complete Java declaration/annotation parser.

Initial whole-class target ranges and unneeded semantic stages incurred hover/
soft-deadline failures. The corrected harness uses the method's range/kind, and
collects only the stages needed for this check. The standalone client still tests
navigation directly. Representative method-scoped collection took roughly 9–15 seconds
at about 290–470 MiB sampled process-tree RSS, with a 256 MiB Java heap, 128 MiB metaspace,
64 MiB code cache and one active processor. Earlier failed attempts remain separate;
these observations do not justify increasing project defaults or calling a timeout
clean output.

The harness denies execution before creating server workspace data, then grants
only its generated root. Gradle/Maven imports, wrappers, autobuild, Gradle annotation
processing, source downloads, telemetry and extra collection stages are disabled.
The disabled Maven importer cannot activate Maven annotation processing in this
marker-free fixture; there are no processor dependencies.
Configuration/data/home are owned temporary directories; no project script or
program is run. Execute one opt-in mode at a time under the shared outer limits:

```sh
node tests/tooling/lsp/live-jdtls-server-smoke.mjs client /absolute/java /absolute/verified/jdtls
node tests/tooling/lsp/live-jdtls-server-smoke.mjs common /absolute/java /absolute/verified/jdtls
node tests/tooling/lsp/live-jdtls-server-smoke.mjs dedicated /absolute/java /absolute/verified/jdtls
```

Primary sources: [official JDT milestone](https://download.eclipse.org/jdtls/milestones/1.61.0/),
[published archive checksum](https://download.eclipse.org/jdtls/milestones/1.61.0/jdt-language-server-1.61.0-202609031315.tar.gz.sha256),
[runtime/launch requirements](https://github.com/eclipse-jdtls/eclipse.jdt.ls/tree/v1.61.0),
and [initialization settings application](https://github.com/eclipse-jdtls/eclipse.jdt.ls/blob/v1.61.0/org.eclipse.jdt.ls.core/src/org/eclipse/jdt/ls/core/internal/handlers/BaseInitHandler.java).

## Exact-lock Pyright validation setup follow-through

The earlier default-Pyright command-profile failure was caused by a missing
application dependency in isolated validation, not the Java authority change.
Only the separate 1.1.414 live-trial package existed. Installing exact-lock
Pyright 1.1.408 into separate validation storage, with scripts and optional
dependencies omitted, closes that setup gap. The cached 4,429,409-byte registry
tarball independently matches the lock's SHA-512 integrity; the unchanged matrix
passes in about 1.8 seconds below 192 MiB RSS. Project source, defaults and the
lockfile are unchanged. Earlier failure receipts remain historical evidence.

## Dockerfile logical-instruction AST route

The already-declared/locked `dockerfile-ast` 0.7.1 package is admitted separately,
with its registry tarball's SHA-512 checked against the project lock and install
scripts disabled. A tiny owned Dockerfile reproduced missed continued FROM stage
headings and false stages/dependencies from FROM/COPY strings inside a RUN heredoc.
The candidate preserves the real logical instructions, stage names, heredoc
extent, escape directives, CRLF and JavaScript/UTF-16 source ranges. No Docker
daemon, image pull/build or instruction execution is involved.

An application-owned bounded parser now feeds chunk headings, imports and relation
exports/usages from the same actual instruction/stage model. Chunk sections retain
their source extents and carry the exact instruction `astRange`. Parser coverage
and relation capability stay partial; Docker/shell execution, complete BuildKit
syntax validation, build graphs and container semantics are not inferred.
The parser retains one immutable result, bounds input characters/lines/instructions
and flags, and respects the existing collector match/line/token/time budgets.

When the installed parser is unavailable, unsupported or fails, chunks explicitly
report the existing line parser, heuristic coverage and fallback reason. No AST
range is invented. This fallback is lower-fidelity and does not establish heredoc
correctness. Tolerant malformed-source parsing is also partial, not proof that a
Dockerfile would build. Parser selection is anchored to application dependencies,
never to a repository-selected module or executable.

The registry route label and deterministic calibration fixture identity follow
the new AST-or-fallback route. Existing conservative Dockerfile byte/line/time caps
are unchanged; synthetic calibration values are not new AST benchmarks. Direct
core-owner regression/comparison checks use less than a second and about 50 MiB
RSS. Whole-dispatch/registry fixtures were blocked at this checkpoint by isolated
missing Babel setup; the bounded integration closure below supersedes that blocker,
without establishing full index acceptance.

```sh
node tests/lang/contracts/dockerfile-ast-boundaries.test.js
```

Primary references: [parser project/API](https://github.com/rcjsuen/dockerfile-ast),
[exact package](https://registry.npmjs.org/dockerfile-ast/0.7.1), and
[Docker heredoc/escape syntax](https://docs.docker.com/reference/dockerfile/#here-documents).
The proprietary Intelephense candidate remains research-only: its
[vendor intended-use licence](https://intelephense.com/eula) was not established
as covering PoC indexing, so it was not installed or accepted.

An unchanged existing import fixture subsequently exposed a FROM compatibility
gap: vendor convenience getters treated a legacy spaced --platform value as the
image and lost the real image/AS stage. The shared model now reconciles bounded
flag/argument tokens from the already parsed instruction, including equals/spaced
forms, continuation and unresolved variables. No physical lines are reparsed;
heredoc text cannot create an instruction. Malformed flag/argument shapes carry a
reason and do not invent an image/stage. Legacy tolerant syntax is compatibility
metadata, not proof Docker accepts or builds that source. The original failing
fixture is preserved unchanged alongside the new focused controls.

## GraphQL descriptions and syntax-only AST ownership

The declared/locked graphql-js 16.12.0 package is installed independently with
scripts disabled, and its 293,649-byte registry tarball matches the project's
SHA-512 integrity. GraphQL 17 and dependency/default migrations remain separate.
The old tree-sitter route label had no corresponding configured native grammar.
Its actual regex owners reproduced phantom type/operation chunks and import/link
URLs from description block strings; the real AST/lexer excludes those strings.

The application-owned bounded helper now shares one immutable syntax model across
chunk, import and relation owners. Descriptions stay with their definition; exact
JavaScript/UTF-16 offsets also separate multiple definitions on one line. Unicode
emoji offsets were checked against actual source slices rather than inferred from
the documentation's offset-unit wording. Schema extensions, named/anonymous
operations, fragments and directive metadata retain their source identity.

Imports come from true lexer comment tokens for the existing nonstandard #import
convention and real @link string arguments. Neither source is fetched. Relation
exports and named-type/fragment references come from real AST nodes, while relation
capability remains explicitly partial/syntax-only. No schema is constructed or
validated and no operation/resolver is executed. Syntax parsing does not establish
schema validity, type resolution or runtime semantics.

Character/line/token/definition/node bounds and existing collector budgets remain
in force. Token-limit classification recognizes the pinned vendor error wording.
Unavailable, malformed, unsupported or budget-limited parsing carries explicit
heuristic fallback metadata without inventing AST ranges; lower-fidelity fallback
does not establish block-string correctness. Parser resolution stays in installed
application dependencies. The corrected route label and deterministic fixture
identity retain the previous conservative byte/line/time caps, not new benchmarks.

The direct-owner regression covers block-string phantoms, actual comments/@link,
emoji/ranges, same-line definitions, extensions, anonymous operations, malformed
input, source/line/token/definition/node limits, collector budgets, missing parser
and invalid source ranges. Line budgets count a declaration's location rather than
its preceding description. Observed comparison and expanded-limit regression
fixtures finish under a second with roughly 45–130 MiB RSS. Whole
dispatch/registry acceptance was separately setup-blocked at this checkpoint;
the bounded integration closure below records its later focused acceptance.

```sh
node tests/lang/contracts/graphql-ast-boundaries.test.js
```

Primary references: [graphql-js v16 language API](https://www.graphql-js.org/api-v16/language/),
[exact package](https://registry.npmjs.org/graphql/16.12.0), and
[pinned parser source](https://github.com/graphql/graphql-js/blob/v16.12.0/src/language/parser.ts).

## Handlebars syntax blocks and static partial ownership

The already-declared @handlebars/parser 2.2.2 package is installed in isolated
validation storage with scripts disabled. Its 127,415-byte registry tarball
independently matches the project's SHA-512 integrity; no dependency/default
version changes are needed. The official parser's public ESM import works, but
its advertised require export fails because CommonJS .js files inherit the
package's module type. On the project's supported Node >=24.15.0, an
application-owned import.meta.resolve of the public import export plus synchronous
ESM loading works without editing vendor files or guessing private entry paths.
Missing or async-only/unsupported loading explicitly falls back to heuristics.

One immutable bounded syntax model now feeds chunk, import and relation owners.
The demonstrated raw-block, escaped-expression and comment phantom blocks,
partials and inline exports are excluded. Real partial-block imports are retained.
Outermost block chunks contain nested blocks without overlapping ranges; exact
UTF-16 ranges support same-line blocks, emoji, LF, CRLF and bare CR. Inline partial
definitions and their lexical block/child visibility are recognised; calls to a
visible inline partial and the special @partial-block are not external imports.
Dynamic partial subexpressions remain explicitly unresolved rather than inventing
an import target. No template files or URLs are loaded.

Relation exports/references come from syntax nodes, but capability stays partial.
The retained bounded heuristic call/flow model is not helper binding, evaluation
or a runtime call graph. parseWithoutProcessing does not compile/render templates,
register or execute helpers, or invoke partials. Malformed-source fallback has
explicit parser/coverage/reason metadata and no invented AST ranges; it does not
establish raw-block or escape correctness.

Character, line, AST-node, depth, entry and name bounds plus existing collector
budgets apply. Parser resolution never takes a repository-selected module/path.
The corrected route identity retains the previous conservative byte/line/time
caps and synthetic calibration values; this is not a new benchmark. Direct-owner
regression/comparison fixtures finish under a second at about 40–110 MiB observed
RSS, using one CPU and no embeddings/models. The combined template/whole-registry
fixture was separately blocked by isolated missing Babel dependencies at this
checkpoint; the focused closure below resolves it. No whole-index or runtime
template acceptance is claimed.

```sh
node tests/lang/contracts/handlebars-ast-boundaries.test.js
```

Primary references: [official standalone parser](https://github.com/handlebars-lang/handlebars-parser),
[exact package](https://registry.npmjs.org/@handlebars%2fparser/2.2.2),
[partial/inline/dynamic semantics](https://handlebarsjs.com/guide/partials.html),
[raw-block/escape syntax](https://handlebarsjs.com/guide/expressions.html#escaping-handlebars-expressions),
and [Node module-relative public export resolution](https://nodejs.org/download/release/latest-v24.x/docs/api/esm.html#importmetaresolvespecifier).

## Parser setup versus document scan deadlines

The unchanged shared import-collector fixture exposed cold graphql-js loading as
another integration gap: a first call spent about 61 ms loading the application
dependency, exhausting a 30 ms document scan clock before returning imports; the
same warm call completed in under a millisecond. Setup is now initialized once
before a document's scan clock for the shared GraphQL, Handlebars and Dockerfile
owners. Its immutable initialization record exposes availability, failure reason,
application-once scope and measured elapsed milliseconds. This is real setup cost,
not work removed from total wall time: the corrected cold fixture took about 56 ms,
including 53 ms recorded setup, followed by a warm call below 0.1 ms.

Actual document parsing and extraction stay inside the existing configured scan
deadline. No deadline, source/token/node/depth cap or failure label is relaxed.
Deterministic controls verify cold setup occurs once and is measured, while
expired parsing and extraction still stop import/relation output and emit scan
time diagnostics. The original shared import-collector assertions now pass
unchanged after the separate FROM-token and setup corrections. This remains local
bounded integration evidence rather than a whole-index or platform benchmark.

```sh
node tests/lang/contracts/ast-parser-initialization-budget.test.js
node tests/lang/registry/collectors.test.js
```

## Protobuf reflection with explicit application lexical ranges

The declared/locked protobufjs 8.8.0 and long 5.3.2 packages are admitted separately
with scripts disabled. Their 757,213-byte and 26,736-byte registry tarballs match
the project's SHA-512 integrity. Tiny parse-only fixtures accept proto2/proto3 and
editions 2023/2024/2026; an unsupported 2025 edition and malformed syntax reject.
This establishes parser component behavior, not protoc/compiler or full SDK acceptance.

The old owners reproduced phantom message/RPC chunks, exports and request/reply
relations from block comments. A shared bounded model now uses verified reflection
for imports, declarations and unresolved field/RPC type strings. protobufjs
reflection and its public tokenizer supply no source offsets. A separately owned
application lexer therefore handles actual comment/string/token boundaries and
UTF-16 positions; chunk metadata explicitly says application-lexer/lexicalRange,
never a fabricated library AST range. Real nested/same-line declarations, oneofs
and qualified extension headings retain their verified reflection identity.

Failure, unavailable/unsupported loading, truncated syntax or expiration produces
only a labelled generic section and no invented declarations/imports/relations.
The unsafe declaration regex fallback is removed. Edition option-imports that the
vendor drops are explicitly unsupported rather than reported as complete imports.
Partial line windows conservatively omit positionless reflection type references;
no positions are guessed for them. Relation/call/flow capability remains partial,
not full type binding or a runtime call graph.

Admission bounds are 786,432 characters, 5,000 lines, 32,768 lexical tokens,
8,192 characters per token, 4,096 reflection nodes and 64 lexical brace levels.
The application pass has a separately justified isolated 100 ms vendor/lexical
ceiling; this is not a replacement for a caller's shorter scan deadline. Import
and relation owners propagate their actual remaining scan time on every admission
checkpoint, and chunks honour the configured per-language/global parse timeout.
The effective limit is always the stricter policy. Synchronous vendor
parsing cannot be interrupted in-process, so its overrun is checked immediately
after return and recorded against the actual effective limit. That is not a promise
of a timer interrupt. Existing collector scan
deadlines still include actual parsing/extraction, with one-time setup measured
separately. Fixtures additionally enforce one CPU, 512 MiB Node heap and a 30-second
process limit; embeddings/models remain off. Conservative route caps and synthetic
calibration values are unchanged, not new performance benchmarks.

Focused controls cover comments, string-contained/same-name/escaped fake declarations,
nested real declarations, UTF-16/CRLF ranges, imports, editions, malformed/truncated
source, missing loader, source/token/node/depth bounds and lexical/vendor/collector
expiration, including caller limits below the isolated ceiling and measured
synchronous overshoot. Loading, resolution, type setup/codegen and RPC paths are guarded by
fixture tripwires. The tiny component regression finishes below a second around
50–85 MiB observed RSS. No imported file/URL is read, no schema is resolved, and
no serialization or RPC is executed.

```sh
node tests/lang/contracts/proto-reflection-lexical-boundaries.test.js
```

Primary references: [official project](https://github.com/protobufjs/protobuf.js),
[public parse/reflection API](https://protobufjs.github.io/protobuf.js/global.html#parse),
and [exact package](https://registry.npmjs.org/protobufjs/8.8.0).

## Bounded registry/dispatcher setup closure

The remaining shared import gap is now closed on source/test head 40be2053. Only
the directly imported Babel parser stack was admitted: @babel/parser 7.29.0,
@babel/types 7.29.0, helper-string-parser 7.27.1 and helper-validator-identifier
7.28.5. The next static registry prerequisites were parse5 7.3.0 with entities
6.0.1, and linguist-languages 9.3.1. All seven exact component tarballs independently
match project-lock SHA-512 integrity; scripts are disabled and storage is isolated.
Each serial install took about 9 seconds with observed RSS below 100 MiB. Project
source, dependency versions, defaults and lockfile were not changed by admission.

These are exact component-provenance claims, not a claim that the entire existing
validation node_modules tree reproduces the lock. The earlier results used existing
Acorn 8.18.0, which differs from the project's exact declared and locked 8.15.0;
that was a version mismatch, not an allowed caret update. The earlier component
and receipts are preserved separately. Exact Acorn 8.15.0 was subsequently admitted
in isolated storage with scripts disabled, and its 130,851-byte tarball matches
the project-lock SHA-512 integrity. All seven affected fixtures actually load Acorn
(verified by a resolution hook) and were rerun with 8.15.0 on ee55ea72, passing
in 0.27–0.52 seconds at roughly 61–79 MiB RSS. Unrelated installed dependencies
remain unchanged; no project-wide dependency hydration was performed.

Seven previously blocked focused fixtures now pass with their existing behavioral
assertions preserved: data-interface adapters, template adapters, build-DSL
adapters, SQL/GraphQL/Proto chunk boundaries, Dockerfile continuation, shared
line-index/UID determinism, and the language registry contract matrix. Each takes
under a second at roughly 60–80 MiB observed RSS. This closes the startup/integration
gap for these small fixtures; it does not establish full indexing, compiler/runtime
template acceptance, every LSP, non-Linux platforms, a broad suite or CI results.
One CPU, Node 512 MiB, embeddings/models off remain the validation policy.

## Mustache parse-token ownership

Mustache 4.2.0 is now an exact application dependency. Its official, zero-dependency
34,584-byte tarball was independently verified against npm SHA-512 integrity and
admitted with installation scripts disabled (5.3 seconds, below 75 MiB RSS).
The public Writer.parse API handles in-document delimiter changes, comments,
sections/inverted sections, literal partial keys and escaped/unescaped lookups.
An application-owned writer has its vendor template cache disabled. No rendering,
view/lambda lookup, partial loading, repository module selection or execution occurs.

The original fixture demonstrated that literal curly tags after a delimiter change
created phantom section/import/relation records, while real custom-delimiter tags
were missed. All three owners now consume one immutable parsed token model with
one-document application caching. Token opening start/end and section closing-tag
start are verified vendor UTF-16 offsets, including emoji and CRLF fixtures. A
section's closing-tag start is not a closing end or a full AST range. Chunk extents
partition the document at outer section starts; nested sections remain represented
in the shared model. The misleading tree-sitter-mustache route is replaced with
mustache-parse-tokens. Existing 192-KiB/3,000-line/1,100-ms calibration baselines and
the old compatibility alias remain unchanged; they are not vendor measurements.

Capability is explicitly partial and syntax-only. Relation exports group section
names, usages record unresolved lookup keys, and the existing calls shape contains
at most 96 heuristic associations. These do not establish executable helper calls,
view binding, partial resolution, template runtime semantics or an AST/dataflow
engine. In particular, Mustache's `{{format item}}` is one literal lookup key;
the small compatibility fixture now uses the actual `{{format}}` lookup rather
than treating it as a Handlebars-style helper invocation. Quoted or punctuated
partial keys stay literal, and backslashes do not acquire Handlebars escape semantics.

Admission/extraction is bounded to 196,608 UTF-16 code units, 3,000 LF-delimited
lines, 16,384 returned tokens, 4,096 semantic nodes, nesting depth 128 and 4,096
code units per semantic name. The isolated parse ceiling is 30 ms; an actual
caller's stricter remaining deadline wins. One-time app-owned initialization is
measured separately, while line indexing, vendor parsing and token extraction
remain inside the document deadline. The synchronous parser cannot be interrupted:
input admission bounds intermediate allocation, returned-token/node limits apply
after parsing, and measured post-call overrun is reported instead of being hidden.
An expired caller is rejected even for a cached model. Missing/unsupported parser,
malformed syntax or exhausted bounds produce a labelled generic chunk and empty
structural imports/relations, without restoring the phantom-producing regex path.

Focused coverage includes delimiter changes in both directions, delimiter-looking
comments, custom-delimiter comments containing fake curly tags, nested/inverted
sections, literal partial names, emoji/CRLF offsets, malformed nesting, missing
and unsupported loaders, source/line/token/node/name/depth limits, caller time
expiry/overrun, cached expiry, line/match/token collector windows, disabled cache
and render/lookup tripwires. Run only the narrow fixture:

```sh
node tests/lang/contracts/mustache-parse-token-boundaries.test.js
```

Primary references: [official public parser and custom delimiters](https://github.com/janl/mustache.js),
[Mustache syntax](https://mustache.github.io/mustache.5.html), and
[exact package metadata](https://registry.npmjs.org/mustache/4.2.0).

## Distinct Jinja and Django lexical boundaries

The existing Jinja owner emitted phantom chunks, imports and relations from raw
block contents and template-expression string literals. The new shared owner is
explicitly `jinja-django-lexical-heuristic`, with partial capability. It has no AST,
Tree-sitter grammar, Python runtime, template compiler, renderer or loader dependency.
Its immutable one-document model supplies application-owned UTF-16 tag/name ranges
to chunk, import and relation owners; no range is attributed to an external AST.

Dispatch is explicit: .jinja/.jinja2/.j2 use Jinja lexical rules; .django/.djhtml use
Django rules. Direct collector calls without a path/extension retain Jinja as the
default. Jinja raw sections and whitespace-control delimiters are supported. Django
named verbatim sections match their exact named terminator, including internal
whitespace; its comment blocks are separately opaque. Tags inside actual variable
and comment token envelopes do not accidentally terminate Django opaque sections.
Django's single-line, first-closing-delimiter rule is preserved; Jinja's quote-aware,
balanced expression delimiters and multiline tags are not silently applied to it.
Cross-dialect raw/verbatim markers or unsupported whitespace-control forms are
explicitly unavailable. Ordinary quoted HTML/text is not treated as a template
expression string: real template tags there remain active.

The lexical model handles bounded inline comments, literal template imports, common
block balancing, headings and ASCII identifier/dotted references. Dynamic include
expressions and unsupported escape decoding remain unresolved. Unknown custom tags,
extensions, full expression semantics, complete syntax validation, template runtime
binding and Django/Jinja AST conformance are outside this model. Relation names and
at most 96 call-shaped associations remain heuristic. Unsupported/truncated lexical
boundaries produce labelled generic content and empty structural outputs instead of
restoring the former phantom-producing regex scans.

Bounds are 196,608 UTF-16 code units, 3,000 LF-delimited lines, 4,096 recognized tags,
32,768 expression tokens, 8,192 code units per tag/token and depth 64. Line indexing,
opaque-block scanning, tokenization and extraction share a 30-ms ceiling and the
actual caller's stricter remaining deadline. Cooperative checks also guard cached
admission. The existing 224-KiB/3,500-line/1,200-ms calibration baseline and old
route alias are preserved; the lexical owner's tighter limits are explicit and
those calibration values are not measured vendor acceptance.

The full-parser gap remains open. Official PyPI metadata identifies Jinja2 3.1.6
and MarkupSafe 3.0.4; their 134,899- and 22,985-byte wheels were independently checked
against published SHA-256 hashes, downloaded serially and installed offline in
isolated trial storage without source builds or bytecode compilation. Python -I
with app-owned package paths, no extensions/loader/cache and compile/render/load
tripwires parsed the original tiny fixture correctly: only Real and real.html
remained. Total fixture time was 0.2 seconds at about 19 MiB; parsing itself took
1.4 ms. Its public AST/lexer provide line-based information rather than verified
absolute source offsets, and production use would require a separate integration.
This is a Jinja reference comparison, not Django or production-runtime acceptance.

The audited cathaysia grammar v0.13.0 is verified at c213d3745ccdcaaa858869181c7b1bf9557a025f;
its package declares Tree-sitter ^0.21.1. The npm package with the same name reports
0.3.3 and no repository field in the queried metadata. The name alone does not prove
identity with that candidate, nor ABI compatibility with this project's 0.25 runtime.
No grammar package, unverified artifact or broad SDK was installed for this batch.

Focused regression coverage includes both explicit dialect dispatches, raw/verbatim
and named endings, comment/variable-wrapped fake endings, whitespace controls,
escaped expression strings, quoted HTML with active tags, CRLF/emoji ranges,
malformed/truncated blocks, literal/dynamic imports, source/tag/token/depth bounds,
line/match/token collector windows and actual caller deadlines. Run the narrow test:

```sh
node tests/lang/contracts/jinja-django-lexical-boundaries.test.js
```

Primary references: [Jinja parse/lexer API](https://jinja.palletsprojects.com/en/stable/api/#low-level-api),
[Jinja raw/whitespace rules](https://jinja.palletsprojects.com/en/stable/templates/#escaping),
[Django named verbatim](https://docs.djangoproject.com/en/6.0/ref/templates/builtins/#verbatim),
[Django lexer implementation](https://github.com/django/django/blob/stable/6.0.x/django/template/base.py),
[verified grammar package source](https://github.com/cathaysia/tree-sitter-jinja/blob/c213d3745ccdcaaa858869181c7b1bf9557a025f/tree-sitter-jinja/package.json),
[Jinja2 metadata](https://pypi.org/pypi/Jinja2/3.1.6/json), and
[MarkupSafe metadata](https://pypi.org/pypi/MarkupSafe/3.0.4/json).

## Explicit JSONC syntax ownership and strict JSON compatibility

The advertised .jsonc route previously resolved to the JSON adapter but dropped
real comment/trailing-comma extends/$ref references and produced only unnamed
generic chunks. The already-declared Microsoft jsonc-parser 3.3.1 component now
owns one immutable syntax model shared by JSONC chunks, imports and relations.
Its zero-dependency 27,354-byte tarball independently matches project-lock and
official-registry SHA-512 integrity. Scripts-off admission used isolated storage,
took 0.4 seconds and stayed below 71 MiB RSS. No version or lockfile changed.

Permissiveness is selected explicitly by .jsonc (or that path suffix for direct
calls), not by comments found in arbitrary JSON. .json and .resolved stay strict,
and anonymous calls remain strict. All three advertised extensions now reach the
format dispatcher. Strict JSON's existing iterative chunk path, including valid
15,000-level nesting and malformed 20,000-level controls, is preserved. Default
config Tree-sitter parsing remains off; JSONC does not use the strict JSON grammar.
The route label is now strict-json-or-jsonc-ast, with unchanged 256-KiB/4,000-line/
1,000-ms calibration values and the old structured-json compatibility alias.

JSONC uses only public scanner/parseTree APIs. Fault-tolerant trees with any parse
errors are rejected. No AST-to-object evaluation, schema resolution, reference/file
loading, formatting or mutation API is used. AST offsets and lengths are verified
UTF-16 node/key ranges, including CRLF, emoji and escaped keys. Effective properties
are selected by decoded, case-sensitive last-key identity without materializing
JavaScript objects. Shadowed duplicate subtrees do not contribute references, and
reported semantic-property ranges point to the actual final property. The existing
case-insensitive reference-key whitelist and value-depth limit of three are shared
with the strict collector; arbitrary string values do not acquire import authority.

Admission/extraction is bounded to 262,144 UTF-16 code units, 4,000 LF-delimited
lines, 65,536 scanner tokens, 32,768 code units per nontrivia token, AST depth 64,
20,000 AST nodes and 20,000 reference-walk visits. Depth/token admission precedes
the recursive vendor parser. Returned node/range checks and the actual caller's
remaining deadline govern extraction. The local ceiling is 30 ms; one-time parser
initialization is separately measured. Synchronous scanner/vendor calls cannot be
timer-interrupted, and measured post-call overrun remains visible. Missing/malformed/
expired parsing returns labelled generic content and empty structural output.

There is one explicit deep-data compatibility path. The former JSONC adapter
already accepted valid strict JSON, including references below the AST depth bound.
A focused 80-level witness demonstrated that a blanket recursive-AST cutoff would
regress that behavior. At the depth boundary, strict native JSON.parse and the
existing iterative strict chunker preserve valid strict-JSON content under source,
traversal and actual caller budgets. Compatibility chunk metadata says
legacy-strict-json/heuristic and records its added document work; no vendor AST
range is invented. Positionless compatibility references are omitted for partial
line windows. Deep comments/trailing-comma JSONC still has an explicit bounded-AST
limitation rather than a hidden depth increase or unsafe regex fallback.

This is partial configuration-syntax/reference coverage, not schema validation,
semantic configuration binding, full indexing or platform acceptance. Focused
controls cover comments/trailing commas, fake refs in strings/comments, escaped
keys, direct and ancestor duplicate keys, reference-value depth, inert prototype
names, strict .json/.resolved dispatch, deep inputs, malformed trees, missing
parsers, resource/caller budgets, cached expiry and excluded API tripwires:

```sh
node tests/lang/contracts/jsonc-structure-boundaries.test.js
node tests/indexing/chunking/json.test.js
```

Primary references: [official parser APIs](https://github.com/microsoft/node-jsonc-parser),
[exact component metadata](https://registry.npmjs.org/jsonc-parser/3.3.1), and
[pinned public parser implementation](https://github.com/microsoft/node-jsonc-parser/blob/v3.3.1/src/impl/parser.ts).

## TOML semantic values and application-owned ranges

The unchanged owners at cc51a24b54d787a6eb4ec856253ebda0ca956c5e demonstrated
two related defects: a multiline documentation string produced a fake dependency
section/imports, while real multiline include arrays were missed and comma-bearing
filenames were split incorrectly. The corrected default route uses the already
declared public smol-toml 1.9.0 parse API for semantic values, with a separate
application-owned string/comment-aware lexical pass for source ranges. One
immutable model supplies default TOML sections, imports and the relation adapter's
imports. No serializer, reference/file loading or configuration evaluation runs.

The semantic parser provides values, not AST nodes or ranges. Metadata therefore
says smol-toml-values+lexical, partial coverage and application-utf16-lexer. Header
ranges point to actual source tokens; section boundaries remain line-anchored.
Reference ranges belong to the containing assignment and decoded key, never to an
invented vendor string node. Quoted/dotted keys and active nested array-table
instances are correlated with own semantic properties. Prototype-like keys remain
inert data; parsed objects are not merged into configuration or application objects.
Multiline assignments crossing a configured partial line window are omitted.

The existing reference-key/dependency-path selection and sanitization are retained,
with semantic string values and equivalent quoted/dotted dependency fields replacing
textual guesses. Version-only dependency strings remain excluded. Duplicate keys,
malformed/truncated syntax, unsupported correlations, missing parsers and expired
work return labelled generic content and empty structural facts. INI's existing
line-based owner is unchanged. Explicit config Tree-sitter chunking remains a
separate supported option; its unchanged native metadata-parity fixture passes.
The default config Tree-sitter setting and language-policy caps are unchanged.

Application admission is bounded to 786,432 UTF-16 code units, 3,500 LF-delimited
lines, 65,536 lexical tokens, 32,768 code units per token, container/key-path/semantic
depth 64 and 20,000 semantic values. The collector's existing 786,432-unit source,
4,096-match, 2,048-import-token and 30 ms defaults remain intact. Actual stricter
caller deadlines govern scanning, synchronous parsing and extraction; the local
ceiling is 30 ms. Synchronous parsing cannot be timer-interrupted, so measured
post-call overrun is reported honestly. One-time app dependency initialization is
measured separately: the small cold witness recorded about 2.1 ms of setup and
2.3 ms of document work. Those observations are not benchmarks or broader workload
acceptance. The route-label/caps fixture update is identity parity, not calibration.

The isolated exact component was installed with scripts disabled. Its 31,492-byte
official registry tarball independently matched the project lock's SHA-512
integrity. Package/lock versions did not change; this is component provenance,
not a whole-validation-tree lock claim. Public parsing explicitly bounds depth,
accepts large integer values without precision failure, and uses the existing
legacy date representation. Upstream date/grammar limitations and bounded app
extraction still apply; no full TOML conformance, schema binding, LSP/compiler,
full-index or platform acceptance is claimed.

Focused controls cover multiline basic/literal strings, escaped quote/line-ending
behavior, comma-bearing names, quoted/escaped/dotted keys, nested array tables,
comments/string-contained fake facts, duplicate keys, inert prototype names,
UTF-16/CRLF positions, malformed/truncated input, missing parsers, depth/node/token/
length limits, caller expiry, cache admission and measured cold initialization:

```sh
node tests/lang/contracts/toml-semantic-lexical-boundaries.test.js
node tests/indexing/chunking/ini-toml.test.js
node tests/indexing/chunking/config-tree-sitter-meta-parity.test.js
```

Primary references: [public parser API and key-safety behavior](https://github.com/squirrelchat/smol-toml),
[exact component metadata](https://registry.npmjs.org/smol-toml/1.9.0), and
[TOML string/key/table semantics](https://toml.io/en/v1.0.0).

## Recorded validation checkpoints

These are dated Linux cloud checkpoints, not a single full-suite result on the
current head. Source/test hashes identify what was actually checked; later
documentation-only checkpoints do not turn earlier receipts into fresh runs.
The detailed sections above retain component versions, provenance, controls and
limits. Native grammar/API fixtures, live clients, collectors, compiler/runtime
acceptance and full indexing are separate evidence categories.

| Checkpoint | Exact source/test revision | Recorded outcome and boundary |
| --- | --- | --- |
| Recovered core | 953aac6bb697f887c69e63b3a9c379acb623e4a9 | Frozen implementation and 18 backup histories restored. Existing focused lifecycle/search/metadata/risk checks and failed/interrupted attempts remain dated evidence; recovery is not a new full-lane run. |
| Recovery follow-through | 03d777d80cd686be172a198fb525a090cd0fe1e0 | SQLite callback-independent cleanup, compatible TypeScript install selection and canonical sqls path passed narrow native/synthetic/source checks. No model loading or full index. |
| Authority hardening | a914c039c11520288c27e9af18a95dfc1d5b75a1; b1f3f22a33c29ac7e4442c3688ff662f4ccac657 | Five new synthetic authority/editor/archive/containment/native regressions plus affected existing fixtures passed. The archive cleanup follow-through and contained Tree-sitter reads are included. Native TUI rebuild and non-Linux acceptance remain open. |
| C#/Groovy | 9df228385d2993674ab4d53cf0b730d228eaf0bb | Exact C# binding/loader, native preflight/chunks and truthful Groovy recovery/partial relation controls passed. No C# compiler or Groovy LSP acceptance. |
| Node LSPs | 9913c55bc9487299c1f13b337e95b6cc443e3fb7 | Tiny actual-client YAML, TypeScript and Bash fixtures plus owned configuration/diagnostic lifetime controls passed. Explicit server/adapter scope is in the record above. |
| Lua/Go/SQL | 4334d8884f0df88d392fdb6e3ea614d19c63c75c | Verified isolated LuaLS/gopls/sqls client/collector fixtures passed. SQLs has formatting/completion evidence, not full type/navigation or database-query acceptance. |
| Rust/Zig authority | 30026be4da7f647082ad4c96600af1a88b839559; fb4fbba8ffea04f8da8a096f6c7f7beb575fff64; d58dd81d213a018f90284e943a764f4d8e993052 | Exact launch-owned repository guards and benign owned-root live fixtures passed. Native Rust AST remains independent; Zig is tooling-only. Build-server readiness stayed inside the bounded fixture deadline. |
| Rust cache/partition | a22336baf38935b8e090c049753f9edad36ea603 | Three recorded baseline failures were corrected with their behavior assertions retained; blocked-state precedence, participating cache metadata and excluded-root contracts passed targeted controls. |
| Python alternatives | ac5431c54faa470ceda5f86edf70709da0b989fa; d875531ca4af2863f45b8c64a210e73e8c470113 | Dedicated Pyright, generic ty and diagnostics-only Ruff tiny fixtures passed their stated scopes. Diagnostics-only lifecycle is covered; the default was not replaced. Exact-lock Pyright 1.1.408 subsequently passed the existing command-profile matrix. |
| clangd | 74b29f586f387760c6d91cec1c180424731566cb | C17/C++20 actual-client/common/dedicated collector controls passed with owned compile commands and unsafe/background features disabled. Objective-C/Apple SDK and platform acceptance remain open. |
| Java/JDT | 23a1fcf02606c2da07d171f019ad899ae18c21d0; 411958dc76ec2716603f8aa801f67e5b7ee2cef0 | Exact-root authority and standalone owned-root client/collector fixtures passed with imports/build/APT disabled. Method types use labelled source bootstrap; javac, project import/build and full SDK acceptance are not claimed. Final observed resource limits are recorded at e9e4ec9cd35531ec7ea32cb0ebef3dce8a324aa5. |
| Dockerfile | 277dddd4d23fec3db1acfb2f30afa34d05ef4e8f; 5192b859ba9d8552e087fabd7bd1bbf3aca4c6c3 | Shared logical-instruction AST controls passed; the unchanged collector exposed and verified the separate FROM-platform compatibility correction. No Docker execution. |
| GraphQL | d9e5ffa77fbc8e2dfee0001b41703749922ca832 | Syntax-only owner/range/import controls passed. Expanded budget fixtures use the corrected 45–130 MiB resource range recorded at 6b979ee7a3f1cd5826631b4f641af3cbfe7ac7b8. No schema execution or GraphQL17 migration. |
| Handlebars and setup accounting | e83be78f6bfc19ca0fce210e480cca2a4ead4b90; b29da51ebb8aca7f502d09a613c4f7324e2b67ce | Public parser import route and static-partial/block controls passed. The unchanged collector exposed cold-load timing; one-time initialization is measured separately while scan deadlines remain intact. No template execution. |
| Protobuf | 40be2053500326945f6b9adbfbfcdb04eb356846 | Seven exact-head focused owner/collector/setup/caps/taxonomy/doc checks passed. Semantic reflection and application lexical ranges have separate provenance; stricter caller deadlines win. |
| Registry closure and Acorn correction | 40be2053500326945f6b9adbfbfcdb04eb356846; ee55ea728fe640eac5372aa22ebb54c4423f03b3 | Seven previously blocked fixtures passed with unchanged assertions. Earlier Acorn 8.18 receipts are not exact-lock claims; all seven affected fixtures were rerun with verified 8.15 at ee55ea72 and actual resolution hooks. Documentation at ee55 has identical source/tests to 40be. |
| Mustache | aa47f83ece0ab35a8584122a32b6302db6cb5468 | Nine exact-head focused checks passed, each below 0.57 seconds/<75 MiB; formatter 27.6 seconds. Vendor parse-token ranges and syntax-only capability are explicit. |
| Jinja/Django | 39f0f5b12a4766b62ae0ce82aac2bc65dffb9952 | Ten exact-head focused checks passed, each below 0.52 seconds/<86 MiB; formatter 29.2 seconds. Distinct lexical dialects are heuristic/partial. The verified Python reference comparison and grammar ABI gap do not imply production AST acceptance. |
| JSONC | be388506c38d9cf9392192dce7d4040f6c2ec051 | Nine exact-head focused checks passed, each below 0.62 seconds/<94 MiB; formatter 28.0 seconds. Explicit syntax ownership, effective last-key ranges and strict/deep compatibility are covered; deep lenient JSONC remains bounded. |

Historical core/dependency records remain in the
[branch/capability review](../branch-capability-review-2026-10-02.md),
[dependency guide](dependency-security.md), dated
[Rust dependency receipt](../security/rust-dependency-validation-2026-10-02.json) and
[embedding/HTTP receipt](../security/embedding-http-validation-2026-10-02.json).
Those old embedding checks do not authorize current model downloads. The interrupted
historical ci-lite run recorded 477 passes, two later-corrected fixture failures
and seven unverified timeouts; focused corrections do not constitute a completed
lane. Recorded Rust test execution had zero defined unit tests and is not behavioral
coverage. Dated audit results are not current hosted-alert closure; the later braces
development-tool advisory remains parked, without gate suppression.
Broad release/platform/native-backend/TUI/performance and hosted-security acceptance
remain deferred. No new GitHub CI check, rerun or security workflow was used here.
