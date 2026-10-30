# Compiler source joins for file URLs

Compiler-qualified fork and browser Worker constructors retain their exact
`new URL(relativeLiteral, import.meta.url)` authority checks. The source owner
supplies a physical container from its admitted inventory or exact embedded
mapping. A shared resolver forms that container's file URL, resolves the literal
with WHATWG semantics and converts with Node's platform-aware `fileURLToPath`.
The resulting path must stay inside the admitted repository and match exactly
one inventory candidate under the existing platform path identity rules.

Percent spelling is not physical filename identity. `%63hild.ts` resolves to
`child.ts`; `%2563hild.ts` addresses a literal `%63hild.ts`. Encoded spaces,
Unicode and dot segments follow URL semantics. Encoded separators, malformed
encodings, null bytes, unknown/outside physical origins, query/fragment inputs
and unsupported mappings remain unresolved. No filesystem/network discovery is
performed by the resolver. Node workers retain their narrower percent-escape
rejection; WASM retained-byte admission is unchanged.

A browser join is a conditional static source candidate in the supplied physical
mapping. It does not attest a served resource URL, bundler mapping, successful
worker/process launch, callback activation or message delivery. Original platform
declaration, source hash, exact mapping and unique inventory fences remain.

The URL repair advanced boundaryFlow11/workerFlow10. Current workerFlow11 also
includes the [shared transfer-options projection](compiler-transfer-options.md). New pure resolver
and actual compiler/stored-graph controls distinguish decoded and literal-percent
children, source refs on exact invocations, browser consumers, Node's narrower
admission and reordered scheduling. Drive/UNC conversion checks are host-qualified
and perform no I/O. All regressions are authored and unrun; existing boundary,
worker, fake-platform and retained-WASM controls remain required.
