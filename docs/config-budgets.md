# Config Budgets

These budgets cap the public surface. If a new knob is required, another must
be removed first.

## Repo config keys

Target: 2 keys

- `cache.root`
- `quality`

## Env vars (public)

Target: 1 var

- `PAIROFCLEATS_API_TOKEN`

## Public CLI flags

Target: 15–25 flags across core commands.

The canonical list is in `docs/config-contract.md`.

## Rationale

- Fewer knobs means fewer invalid states, lower support cost, and consistent UX.
- AutoPolicy provides safe defaults across machines and repo sizes.
- Secrets remain in env vars to keep deployments secure.
