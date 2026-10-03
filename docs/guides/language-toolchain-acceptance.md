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
harness is opt-in and is not selected by the automatic test lanes. Existing
configured-provider integration fixtures remain dependency-blocked by missing
`smol-toml` in the isolated setup; direct client acceptance does not replace them.

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
