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
