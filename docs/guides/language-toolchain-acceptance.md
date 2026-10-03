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
runtime fixtures completed around a second below 256 MiB sampled process-tree RSS.
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

Run the affected fixture with installed native dependencies:

```sh
node tests/indexing/tree-sitter/csharp-groovy-coverage.test.js
```

Trials run serially with one CPU, a 512 MiB Node heap, a 768 MiB sampled process-tree
RSS stopping rule and 2 GiB available-RAM reserve. Tests are bounded to 30 seconds;
installation or compilation steps are separately bounded to 180 seconds. Embeddings
are off and model access is offline. The locked-runtime rebuild completed in about
25 seconds, with sampled process-tree RSS below 448 MiB. Native syntax and chunking
checks complete in under a second. These are resource observations, not benchmarks.
