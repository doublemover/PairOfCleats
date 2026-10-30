# LSP workspace and method health

Configured LSP providers share durable advisory health through the existing
tooling cache, atomic writer and file-lock owners. It is distinct from cached
request results, provider output and semantic provenance. Dedicated providers
retain their existing health owners until explicitly adopted. No public setting,
installer, scheduler or Lua-only health stack is added.

Identity includes source bytes/virtual mappings, canonical repository/workspace
roots, actual command path and exact native stat identity, Node/platform/architecture,
environment, initialization/configuration, request timeouts/concurrency and health
policy. Known configuration files and their absence contribute observations; Lua
includes `.luarc.json` and `.luarc.jsonc` at repository/workspace roots. This is
health context, not complete SDK/dependency closure or binary-content qualification.
Raw environment values never enter stored health or diagnostics.

Observation admits at most 4,096 documents, 8 MiB of source/config bytes, 32
configuration names and a 4 MiB declaration. Unknown/refused identity disables
durable reuse. Health uses an explicitly selected cache root, including when
output caching is disabled; without one it stays local. Corrupt, foreign,
shared-file, oversized and future-dated current-context metadata is neither
reused nor overwritten. Unknown fields and inconsistent method timestamps fail
admission. Stored bytes must fit the bound using their actual pretty-JSON format.

One version-1 receipt per provider/repository/workspace retains at most eight
context variants and fifteen canonical method states, within 256 KiB. Healthy
method success clears prior failures. Timeout, transport and malformed reply
remain distinct. Lua keeps its existing first-timeout cutoff; other configured
profiles use three consecutive failures. Cooldowns share existing reliability
defaults: 15 seconds for timeout, 60 seconds for transport/malformed failure.
Changed context admits fresh work; expired matching state permits one controlled
method probe through existing exclusion, retaining actual work/metadata settlement.

Known cooldown applies before enqueue; queued work rechecks at dispatch. Healthy
methods/roots can still contribute. An initialize cooldown explicitly defers the
provider. Settled observed method failure retains diagnostics without a duplicate
generic provider breaker trip. Transport/protocol corruption still poisons the
actual session; missing identity or failed persistence keeps conservative provider
behavior. Only the original in-process owner can issue these decisions. Lookalike
server codes/fields cannot suppress failure accounting.

PID death or a serialized receipt grants no release. Recovery never repeats
failed publication. Persistence errors retain original request/result and
independent metadata causes. Diagnostics separate fresh callback attempts,
suppressed methods/requests, reused health, recovery probes, published writes,
persistence failures and withheld retry allowance. Allowance is not measured
transport work. Existing session/native/VFS owners retain physical authority.

Implementation is **functionally unqualified**. The
[source receipt](../archived/workspace-method-health-implementation-2026-10-28.md)
maps 29 authored controls and remaining Windows acceptance. Historical author
cache entries are not fresh qualification evidence.
