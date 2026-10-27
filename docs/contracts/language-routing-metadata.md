# Language routing metadata

Current source and four import-boundary fixtures are unvalidated.

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
No module-count, startup latency, CPU, heap or RSS result is claimed.

#1607 remains open for selected adapter-family loading at asynchronous ownership
boundaries, independent prose dispatch/fallback imports, worker initialization
and actual resource/performance qualification. The existing full registry remains
eager for operations that still import it. No public options, routes or parser
quality contracts were changed by this metadata extraction.
