# Saved-claim verification and response admission

Every saved-claim query retains the existing all-family verification promise:
all cited observations, including supporting and contradicting observations for
other pages, must match their pinned capture/family/row identities. Every retained
raw dependency they reference is hashed on each request, with within-request hash
deduplication. There is no pathname-only or global already-verified cache.

Response `maxBytes`/`maxRecords` govern the returned claim page. They do not size
all-family observation hydration. Physical verification has separate fixed limits:
two pinned families, 128 citation rows, 1 MiB of hydrated observations and 128 MiB
of retained raw verification. Existing family metadata/member/index read caps and
the request's single operation deadline still apply. Internal fixture controls may
only lower physical limits. No public request/configuration knob was added.

The optional, strictly declared result `verification` receipt records its
`all-family-citations` scope, confirmed citation verification, applied limits and
separate physical costs: citation rows, hydrated observation bytes, raw hash bytes,
family opens, family metadata/index verification, claim-family verification,
selected claim row reads and final response bytes. Family opens count attempts.
Elapsed time belongs to this invocation. These counts are not process RSS or
performance qualification. A one-row response can require all-family work, and
traversing two pages repeats that work explicitly.

Physical refusal throws `ERR_RUNTIME_QUERY_BUDGET` with consumed, next-required
and limit basis in a bounded producer-attested `runtimeClaimVerification` receipt.
HTTP retains status 422; MCP retains the typed domain receipt. Response byte and
deadline refusals use their own basis. Serialized error-property lookalikes cannot
supply attestation. Actual malformed/missing/changed rows, raw bytes, hashes,
namespace/generation and offsets retain integrity/scope/availability errors.
Raising only the page allowance cannot repair corrupted evidence.

All original query-family native/file owners close on success/refusal. Selected
claim reads also preserve primary failure together with independent close failure.
Budget diagnostics are projected after settlement and do not authorize execution,
collection, mutation or cleanup. Immutable prior claim families remain queryable.

The authored regression uses real imports from two saved captures, sixteen
distinct source-qualified observations and two claims with separate support and
contradiction subsets. It checks a fitting one-row page whose all-family support
exceeds response bytes, unchanged claim identity under a larger allowance,
exact-once pagination, repeated physical work, lowered physical refusal, original
raw tampering, file closure and HTTP/MCP receipt projection. Existing recovery,
missing/scope/cursor/contradiction and publication-cancellation controls remain.
Functional execution remains deferred; these are implementation and authored
coverage facts, not final-head acceptance or measured performance results.
