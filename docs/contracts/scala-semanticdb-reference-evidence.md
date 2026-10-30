# Source-pinned Scala SemanticDB evidence

Status: **UNVALIDATED offline subset** for #1173, using the existing canonical
source-linked evidence writer, provider sink and detail consumer. No compiler,
Metals, build server, fixture, syntax check or gate ran for this source release.

`prepareSemanticdbReferenceEvidence` imports an explicitly supplied binary
SemanticDB4 artifact of at most 256 KB against at most twenty original Scala
sources / 500 KB. Its independently captured producing receipt binds artifact
SHA256, original source SHA256 and parser partition identities, generation,
mapping identity, compiler and producer versions, observed profile, build target,
platform, classpath, configuration and dependency hashes. An unavailable receipt
returns non-authoritative evidence; mismatched authority fails. Supplied source
text and MD5 are additional freshness checks and cannot replace the receipt.
There is one build variant per batch. A document with another build target is
rejected, and a legacy missing target retains the receipt-only qualification.

The bounded wire projection follows the [SemanticDB specification](https://scalameta.org/docs/semanticdb/specification.html)
and its [upstream wire schema](https://github.com/scalameta/scalameta/blob/main/semanticdb/semanticdb/shared/src/main/proto/semanticdb.proto).
It retains symbol metadata and occurrence roles with exact UTF-16 original
ranges. Local symbol IDs stay document scoped; global candidates stay inside the
receipt's build target. Multiple definitions remain ambiguous. Missing external
definitions stay unresolved. Supplied paths cannot escape the source inventory,
including percent-encoded traversal. Malformed binary fields, duplicate singular
fields, conflicting tree variants and node/depth/field/output budgets fail
admission. Unknown fields remain available in the complete retained artifact.

Synthetic applications have separate compiler-synthetic evidence and original
anchor spans. Only supported application trees with explicit symbol IDs can
produce candidate references. Generated application structure does not become a
source invocation, runtime call-flow fact or replacement parser declaration.
Unknown tree variants, function/macro expansion bodies, type structures and
signatures are retained as opaque wire evidence, without guessing type meaning.
The complete original bytes and opaque signatures remain available in detail.

`indexing/semantic/scala-semanticdb-reference-evidence` is an authored, unrun
binary-receipt fixture that reaches the actual common storage/sink/detail owners
with synthetic parser inventory. It covers cross-source references, implicit
application evidence, local-ID isolation, ambiguity, stale source/target,
wrong generation, encoded path escape and bounded decoding. It establishes no
operational Scala parser admission, executable/compiler compatibility or
published-index proof. Normal Scala syntax admission, the selected Metals/BSP
route, approved runtime recipes, complete structured signatures, Scala 2/3
real-tool examples and TASTy-only families remain pending. Every report remains
partial with an explicitly unqualified application decoder closure.
