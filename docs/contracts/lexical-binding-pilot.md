# Closed lexical binding pilot

Unvalidated first slice of #1506. The internal `lexical-local-first-v1` profile
resolves one namespace/datum through a lexical parent chain. Closed local
declarations shadow outer scopes even when inaccessible. Duplicate accessible
declarations remain ambiguous. Unknown access, open inventories, unsupported
features, missing scopes, cycles, work limits and cancellation retain an explicit
frontier. A completed lookup does not certify whole-program well-formedness.
Candidate counts and expanded path witness references have independent bounds;
either limit retains an unknown frontier instead of slicing a complete answer.

`src/semantic/lexical-binding.js` consumes existing canonical scope/declaration
records and requires upstream admitted closure receipts plus explicit profile
namespace/datum/access annotations. Syntax coverage cannot supply those binding
receipts automatically. No existing semantic schema, producer or analysis-version
constant changes in this query-only pilot. Public/provider wiring remains gated.

Every visited lookup retains positive/negative scope dependencies, including the
empty name partition, parent and closure identity. Confirmation accepts only the
same immutable world/profile and unchanged direct footprints; new generations
require re-resolution. It does not implement cross-file residual confirmation or
claim cyclic incremental reuse. Upstream facts/receipts are trusted admitted
inputs; this seam must not accept unchecked caller assertions as public proof.

The retained consumer in `src/semantic/retained-lexical-binding.js` reads the
selected syntax partition through the existing pinned artifact store. It checks
the actual occurrence and starting scope, captures canonical source bytes once,
checks source coordinates, and derives the source snapshot identity from the
retained manifest and store inventory. Namespace/datum/access annotations and
closure receipts remain trusted upstream profile inputs; physical inventory
completion does not supply them. Imports, mapped sources and cross-partition
scope parents are outside this file-local adapter.

The input scan has row, retained metadata and source byte limits. A row prefix,
including one that exactly reaches its allowance, forces declaration/parent
closure open; it cannot prove a missing or unique target. The optional task-lens
consumer reuses that same captured source with the existing exact-source lens.
Every ambiguity candidate is mandatory, so presentation overflow remains
explicit. Source witnesses and a completed declared-model lookup grant no edit
authority or native-language binding proof. The canonical writer/store/query/lens
regression source is authored and unrun.

Remaining work includes canonical public schemas, real language profile
extraction, compiler differential qualification, a second distinct adapter,
imports and access-sensitive order, stack paths/specialization, scope patching,
dependency updates across revisions, durable reuse and measured ablations.
The authored regression source has not been executed.

Retained lookup and the inert retained rename consumer now share
`retained-lexical-inputs.js` rather than independently reading the same partition
for every preservation query. The capture includes canonical occurrences beside
scope/declaration rows and exposes separate inventory and admitted-profile hashes.
Caller selections and profile maps are copied before awaited reads; the metadata
allowance includes source manifests and retained occurrence metadata. These
request-local captures do not introduce a persisted store, automatic profile
admission or cross-revision reuse authority.
