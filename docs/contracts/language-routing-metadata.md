# Language routing metadata

Current source and ten import-boundary fixtures are unvalidated.

`language-registry/routing.js` resolves immutable metadata from the existing
canonical descriptors and Linguist mapping. It owns no parser, native grammar,
adapter initialization or source/AST cache. Construction captures ordered lookup
maps once; warm lookup returns the same frozen descriptor. It cannot establish
parser availability/readiness, and does not expose partially constructed adapter
methods or return a Promise from a synchronous metadata call.

The shared chooser preserves precedence: exact descriptor filename, descriptor
extension, descriptor prefix, Linguist filename, then Linguist extension. Existing
normalization and first-owner ordering remain. Real `getLanguageForFile` uses the
same chooser with its actual supported adapter IDs and returns the existing
adapter object; execution, prepare mutation and fallback behavior remain on that
registry boundary. No duplicate extension/language catalog was introduced.

Eleven reviewed callers that need only IDs/hints now import metadata directly:
discovery, watch classification, preprocessing, sharding, scheduler shadow,
Tree-sitter planning, file analysis hints and token routing. This removes their
unnecessary direct dependency on adapter construction. It does not prove that
other imports in those complete entry points cannot reach a parser graph.

Four authored fresh-process import-guard cases cover extension/filename/prefix
precedence, availability filtering, unknown routes, immutable/warm identity and
absence of adapter methods. Descriptor parity also checks all actual adapter IDs
and preserves existing concrete adapter assertions. These cases have not run.
No measured startup latency, CPU, heap or RSS result is claimed.

Registry construction now retains operation wrappers without initializing their
language module graphs. The first actual operation loads its literal repository
module through Node 26 synchronous ESM support and caches its function. Arguments,
return values/Promises and exceptions pass through; no missing-module fallback,
empty-result substitution or synchronous-to-async API change is introduced.
Adapter identity, capability methods, ordered dispatch and existing prepare logic
remain. Operation function identity/name/arity are not metadata capabilities.
Only synchronous module graphs belong at this boundary; a future top-level-await
dependency must adopt an explicit asynchronous preparation owner. Existing
asynchronous prepare methods still await their real operations.

Code-language and format chunkers also load on their actual dispatch branch.
Prose fallback and ordinary Markdown do not initialize code-family parsers.
Conditional Tree-sitter format/heuristic owners load the generic parser only when
their existing operation actually requests it; configuration and native readiness
contracts still apply. The format reexports retain their synchronous API.

Six additional fresh-process guards are authored for cold concrete-adapter lookup,
prose context/Markdown/fallback, actual JS/TS/config import collection and requested
load failures. Positive source imports and negative comment/string controls,
warm content parity and load-error propagation remain assertions. No fixture has
run. #1607 remains open for complete worker/entry-point initialization, actual
operation/consumer parity, native lifecycle, import-budget and performance
qualification. Static source graph comparisons are distinct from runtime counts.
