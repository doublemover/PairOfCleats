# Config Budgets

These budgets track the public surface and the total inventory. Any new knobs
must be documented in `docs/config/contract.md` and added to the config
inventory checks.

## Repo config keys

Accepted namespaces and keys come from `docs/config/schema.json` and runtime consumers, not a duplicated namespace list. Public-budget keys are a reviewed subset of that accepted surface. Permissive schema extension areas still need an actual consumer. See [the edit workflow](inventory-notes.md#editing-supported-configuration) for declarations and registered generation.

## Env vars (public)

Target: align with `docs/config/contract.md` and `docs/config/env-overrides.md`.

## Public CLI flags

Target: keep core command flag counts intentional and documented. The executable
allowlist and limits live in `tools/config/inventory.js`; the generated contract
and inventory describe the supported surface.

The gate counts `cliFlags.publicDetected` from its declared public entry points,
not every allowlisted flag found anywhere in the repository. The generated
inventory reports both sets. This is change governance, not an access-control or
runtime security boundary.

## Current reviewed limits

- Public config keys: 5
- Public env vars: 1
- Public entry-point CLI flags: 78

Current total/schema/internal counts are generated in `docs/config/inventory.md`
and `docs/config/inventory.json`; do not duplicate a stale snapshot here.

The 2026-10-28 budget of 78 includes the previously reviewed task/path options
(77), plus `--renderedTokenBudget` for #1125. This JSON option defaults absent
and binds a caller-selected exact allowance to a pinned local tokenizer profile.
It cannot be inferred from automatic hardware policy. No config key or environment
variable is added. Request/schema, exact-count, authority and cross-surface fixtures
own its admission; runtime and measured performance qualification remain pending.

The 2026-10-10 increase from 71 to 72 admits `--includeSemantic`, the explicitly
requested context-pack evidence opt-in. It defaults off and controls bounded
extra output/work per invocation, so AutoPolicy cannot infer the user's intent.
The context-pack module owns it; it adds no environment variable or repository
config key. Shared request projection/schema and evidence fixtures cover it.

Update these budgets only when intentionally expanding or shrinking the
documented surface area.

The 2026-10-11 increase from 2 to 3 admits
`tooling.typescript.typeRepresentation`, an explicit versioned backend choice.
It accepts `legacy` (default, existing TypeScript presentation) or `symbolic`
(experimental closed finite-string annotation IR). The symbolic backend does
not publish partial answers as complete or automatically expand unsupported
types in the legacy checker. Eligibility, source authority, configuration and
provider fixtures cover this mode. Cache/replay reuse is disabled in symbolic
mode until a live complete compiler-context fingerprint is available. See
[the backend contract](../guides/typescript-symbolic-types.md).

## Rationale

- Fewer knobs means fewer invalid states, lower support cost, and consistent UX.
- AutoPolicy provides safe defaults across machines and repo sizes.
- Secrets remain in env vars to keep deployments secure.


The 2026-10-22 reviewed surface includes `indexing.workerPool.processFallback`
(default false, explicit bounded process transport) and `indexing.crossFileFidelity`
(default `bounded`). The latter selects semantic candidate admission independent of
RAM, CPU and automatic quality: `comprehensive` processes the collected supported
candidate set through existing bounded propagation bundles and artifact spill owners.
It does not certify extraction or program-analysis completeness. Policy/version
identity invalidates incompatible replay; durable omission receipts accompany the
generation, graph and risk output. The public-key budget advances from four to five
for this single fidelity choice; no environment variable or CLI flag is added.
