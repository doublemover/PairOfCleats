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

Subkeys must exist in the schema; unknown keys are rejected.

## Env vars (public)

Target: align with `docs/config/contract.md` and `docs/config/env-overrides.md`.

## Public CLI flags

Target: keep core command flag counts stable and documented (see the public
flag allowlist in `docs/config/contract.md`).

The canonical list is in `docs/config/contract.md`.

## Current baseline (from `docs/config/inventory.md`)

- Config keys: 180 (leaf keys: 141)
- Env vars: 58
- CLI flags: 252
- Public config keys: 2
- Public env vars: 1
- Public CLI flags: 8

Update these budgets only when intentionally expanding or shrinking the
documented surface area.

## Rationale

- Fewer knobs means fewer invalid states, lower support cost, and consistent UX.
- AutoPolicy provides safe defaults across machines and repo sizes.
- Secrets remain in env vars to keep deployments secure.

