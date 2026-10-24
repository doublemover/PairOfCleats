# Framework semantic source maps

Status: **UNVALIDATED implementation subset** for issue #1190. No compiler,
language server, fixture or gate was executed for this change.

Astro component frontmatter is admitted as TypeScript, including frontmatter
without annotations. Browser script blocks retain their existing explicit
language handling. The installed Astro compiler's parser supplies the original
frontmatter range; the existing segmentation and immutable embedded-source
owner preserve that exact slice. This enables the existing TypeScript syntax
collector to retain interfaces, annotations and indexed-access types instead of
routing them through the JavaScript parser. The canonical embedded-linear map,
source hashing and storage contracts remain authoritative.

Compiler and LSP document joins now require a supplied semantic source ID to
agree with its exact retained container or embedded route. Equal text cannot
move that ID to another path or override a different pinned segment. LSP source
inventory rejects competing canonical paths and duplicate retained source IDs;
an unpinned embedded route with multiple equal-text candidates is an ambiguity
error. An exact matching source ID may disambiguate that route. No first-match
selection or plain-parent fallback upgrades an inconsistent source assertion.
The extended immutable-join and embedded-cache controls are authored and unrun.

The version-one embedded-linear map now has an authoritative schema/validator
used by its writer and common retained reader. Compiler, LSP and embedded-cache
consumers share one contained checksum-verified canonical sidecar read. They
check local coordinates, language, quality and immediate parent identity;
exact mappings additionally compare the two actual retained source slices and
reject UTF-16 surrogate splits. Cache relocation verifies supplied parent bytes
against the admitted parent hash before interpreting any segment map.

The LSP session retains verified parent source metadata for mapped segments even
when its selected provider languages exclude the container. This preserves
ordinary typed-script routing under a Vue-like parent without enabling that
container's provider or inventing framework binding completeness. Missing parent
authority and corrupt/noncanonical maps remain errors. Synthetic/coarse quality
stays explicit and cannot become exact merely because a segment is routable.
The map/source/cache and filtered-parent integration fixtures are authored and
unexecuted; published discovery-to-consumer and platform qualification remain
pending.

This follows the [Astro TypeScript contract](https://docs.astro.build/en/guides/typescript/).
The authored `indexing/semantic/astro-frontmatter-dialect` fixture exercises the
actual app parser and TypeScript collector with Unicode, CRLF, a browser script,
typed declarations and canonical source/partition storage. Its parser fixture
and all assertions are unrun.

An explicit tooling adapter also calls the installed `@astrojs/compiler` 2.13.1
`convertToTSX` API without project configuration, preprocessors, module loading
or service execution. This is the existing app compiler version, not the required
2.x-to-4.x migration. Input, generated code, raw source map, diagnostics, mapping
points and retained output have fixed byte/count bounds. The synchronous WASM
call cannot be preempted internally; cancellation/deadline checks before and
after it discard late output. Hard runtime/memory qualification remains pending.

Generated TSX is a branded immutable tooling document with original source,
syntax, generation, configuration, dependency, code and map identities. It is
never admitted as an independent user/source partition. The adapter decodes only
the compiler's single-source v3 map, following the [source-map specification](https://tc39.es/ecma426/).
An anchor alone is coarse. An interval becomes exact only when both adjacent
anchors, code-point boundaries, length and all intervening UTF-16 text agree.
Generated gaps and altered fragments remain synthetic/coarse. Conflicting
anchors, malformed coordinates, external sources and map budgets fail admission.
Reverse projection preserves disjoint original intervals; it never fills gaps.

An independently pinned producing receipt can attach captured definition,
type-definition and reference observations to this generated document.
`prepareAstroMappedEvidence` maps exact observations to the original source and
retains raw map/code/observations through the common evidence writer, provider
sink and source-qualified detail consumer. Multiple target intervals remain
non-navigable candidates; external targets stay unresolved. Duplicate mapped
observations in one batch share an ownership key. The implementation does not
claim global TS/framework ownership coordination or acquire a service binding.
Every report is partial with unqualified app-compiler/service closure.

`indexing/semantic/astro-generated-source-evidence` is an authored, unrun fixture
using the actual installed compiler with a synthetic original parser inventory
and captured service records. It exercises a template expression/declaration
map, Unicode/CRLF, synthetic/coarse intervals, duplicate ownership, stale
generation, external targets, cancellation and canonical storage/detail. The
captured service record is not proof that a real language service found the
binding.

Operational original-template binding acquisition, component props/emits/slots
and Svelte rune/snippet/Kit types remain pending. There is no new framework
service profile or approved managed executable pin. Vue/Svelte
compiler qualification, the Astro 2.x to 4.x migration, actual TypeScript service
version compatibility, trust for executable preprocessors/configuration and a
discovery-to-published-consumer proof are still required. Existing script
segmentation does not establish those semantics or complete framework coverage.
