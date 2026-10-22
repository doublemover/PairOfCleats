# Closed lexical binding pilot

Unvalidated first slice of #1506. The internal `lexical-local-first-v1` profile
resolves one namespace/datum through a lexical parent chain. Closed local
declarations shadow outer scopes even when inaccessible. Duplicate accessible
declarations remain ambiguous. Unknown access, open inventories, unsupported
features, missing scopes, cycles, work limits and cancellation retain an explicit
frontier. A completed lookup does not certify whole-program well-formedness.

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

Remaining work includes canonical public schemas, real language profile
extraction, compiler differential qualification, a second distinct adapter,
imports and access-sensitive order, stack paths/specialization, scope patching,
dependency updates across revisions, durable reuse and measured ablations.
The authored regression source has not been executed.
