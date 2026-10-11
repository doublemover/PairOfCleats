# Config Budgets

These budgets track the public surface and the total inventory. Any new knobs
must be documented in `docs/config/contract.md` and added to the config
inventory checks.

## Repo config keys

Allowlist: align with `docs/config/schema.json` top-level namespaces:
- `cache`
- `quality`
- `threads`
- `runtime`
- `tooling`
- `mcp`
- `indexing`
- `retrieval`
- `search`

Subkeys must exist in the schema; unknown keys are rejected. Supported config
names in the inventory derive from that schema, not a second manual allowlist.
See [the edit workflow](inventory-notes.md#editing-supported-configuration) for
adding a declaration and regenerating its reports.

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

- Public config keys: 2
- Public env vars: 1
- Public entry-point CLI flags: 72

Current total/schema/internal counts are generated in `docs/config/inventory.md`
and `docs/config/inventory.json`; do not duplicate a stale snapshot here.

The 2026-10-10 increase from 71 to 72 admits `--includeSemantic`, the explicitly
requested context-pack evidence opt-in. It defaults off and controls bounded
extra output/work per invocation, so AutoPolicy cannot infer the user's intent.
The context-pack module owns it; it adds no environment variable or repository
config key. Shared request projection/schema and evidence fixtures cover it.

Update these budgets only when intentionally expanding or shrinking the
documented surface area.

## Rationale

- Fewer knobs means fewer invalid states, lower support cost, and consistent UX.
- AutoPolicy provides safe defaults across machines and repo sizes.
- Secrets remain in env vars to keep deployments secure.

