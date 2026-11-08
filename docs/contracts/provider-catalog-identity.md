# Provider catalog identity

Status: #1659 source repair and authored controls; functional execution deferred.

Registered, configured LSP and automatic preset providers pass one shared catalog
admission owner before allow/deny filters, explicit selection, ordering, profile/
cache preparation or preflight. Provider IDs must be unique after their existing
normalization. Equivalent duplicate definitions are also rejected; ordering never
chooses an implementation or changes accidental execution multiplicity.

`ERR_TOOLING_PROVIDER_ID_COLLISION` identifies the normalized provider ID and both
configuration origins. Origins distinguish registry keys, configured server
locations and automatic presets. Their bounded projection includes no command,
arguments, environment or initialization payload. Configured factory consumers
and complete registry selection use the same uniqueness check. Structural raw
schema validation cannot replace this check after normalization/composition.

Multiple configured server instances require an existing explicit `id` or
`providerId`; a preset-supplied stable identity also qualifies. Ambiguous anonymous
instances fail with `ERR_TOOLING_PROVIDER_INSTANCE_ID`. The legacy single anonymous
provider remains `lsp-lsp-1`, independently of invalid entries preceding it.
An explicit providerId also supplies the fallback server identity when id is
omitted, keeping the effective profile stable under array reordering. Use distinct
explicit instance IDs for independently configured servers in the same family.
No new instance field, ordering syntax, configuration knob or public schema is
introduced. Affected effective config hashes change with normalized server identity.

Explicit `registerToolingProvider` still replaces its normalized registry slot;
repeating that registration remains idempotent. This deliberate host API differs
from accidental duplicate configuration. A configured server ID still suppresses
its automatic preset, and existing explicit-only/exclusive-language/replacement
semantics remain. Collisions remaining after this composition fail even if a
later allow/deny or order list would otherwise hide one entry. Unique catalogs
feed the same ordered provider map for default and explicit selection.

New unrun controls author exact, case and sanitization collisions, registered/
configured and configured/automatic conflicts, origin receipts, explicit replacement,
stable independent instances, order-only multiplicity, selection/deny behavior and
single-anonymous compatibility. Actual fake-provider orchestration checks zero
hash/preflight/run/cache preparation on collision, one observed-profile/diagnostic
execution per admitted instance and order-only cache reuse. Fixture profiles hash
ordinary owned bytes; they do not qualify a real server executable. Existing
selection/preflight/cache and preset controls are retained unchanged.
