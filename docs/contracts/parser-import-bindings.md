# Parser-owned JavaScript and TypeScript import bindings

Status: UNVALIDATED source and authored controls, 2026-10-22.

Both relation builders copy static top-level import bindings during their existing
AST walk. The TypeScript builder previously omitted this file-level map, allowing
its imported aliases to escape to repository-global same-name candidates. The
shared leaf helper emits frozen plain local/imported/module facts only from the
builder's exact source-owned, unrecovered AST. It retains default, namespace,
named and string-literal imported names, including an empty module specifier as
an unavailable module boundary. Nested ambient-module bindings do not become
file-global bindings. No parse, AST or binding handle is added to the handoff.

Declaration-level and per-specifier `type`/`typeof` imports carry `typeOnly:true`.
Cross-file call links, occurrence summaries and legacy call-return resolution
request runtime targets. A type-only binding admits no runtime candidate, keeps
its module hint and reports `type-only-import`. Parser-owned returned
constructions through that binding cannot manufacture a nominal return type.
Generic usage links retain their separate type-capable resolution route; their
request-local cache identity includes the runtime-versus-usage distinction.
Existing stronger compiler-owned occurrence bindings remain independent.

The existing file-relation handoff and full file-relation replay fingerprint
retain these facts. Shared import-resolution and call-flow producer identities
must change together with this source meaning; root owns those version updates.
No public knob, module search algorithm, limit or source fallback changes.

The authored actual JS/TS syntax, lexicon, file/chunk, pinned-source propagation
and cold/warm replay fixture covers aliases, namespaces, string names, anonymous
default exports, unavailable package/relative/configured/empty modules,
declaration/specifier/default/namespace type imports, constructor suppression,
mixed value imports and separate usage resolution. Additional producer controls
cover stale/recovered syntax, Flow type/typeof imports, ambient nesting and
unsupported import-equals. None has run.

Complete exports and reexports, named TypeScript default-export mapping,
import-equals/CommonJS bindings, package/configured alias resolution, local
callable dispatch, recovered/legacy/native/embedded routes, arbitrary supplied
binding authority, source-language/runtime qualification and performance remain
open. This does not establish general module completeness or issue closure.
