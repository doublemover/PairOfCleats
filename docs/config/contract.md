# Config Contract

This document freezes the public configuration surface. It is a hard cut: no new
public knobs unless an existing one is removed to stay within budgets.

## Public repo config keys (.pairofcleats.json)

Only these keys are allowed in repo config files:

- `cache.root`
- `quality` (`auto|fast|balanced|max`)

## Public CLI commands and flags

`pairofcleats setup`
- no flags

`pairofcleats bootstrap`
- no flags

`pairofcleats index build`
- `--repo <path>`
- `--mode <code|prose|both>`
- `--quality <auto|fast|balanced|max>`
- `--watch`

`pairofcleats index watch`
- `--repo <path>`
- `--mode <code|prose|both>`
- `--quality <auto|fast|balanced|max>`

`pairofcleats index validate`
- `--repo <path>`

`pairofcleats search "<query>"`
- `--repo <path>`
- `--mode <code|prose|both>`
- `--top <N>`
- `--json`
- `--explain`
- `--filter "<expr>"`
- `--backend <auto|sqlite|lmdb>`

`pairofcleats service api`
- `--host <host>`
- `--port <port>`
- `--repo <path>`

`pairofcleats lmdb build`
- `--repo <path>`
- `--mode <code|prose|all>`

## Public env vars (secrets only)

- `PAIROFCLEATS_API_TOKEN`
- `PAIROFCLEATS_MCP_MODE` (or `MCP_MODE`) — MCP server mode override (`legacy|sdk|auto`, exception)

Env vars do not participate in normal behavior precedence, except the MCP server mode override (documented above) which can override config for `mcp-server` mode selection.

## Precedence order

1) CLI flags
2) Repo config (`.pairofcleats.json`)
3) AutoPolicy (derived from resources and repo characteristics)
4) Code defaults

## Naming conventions

- Config keys: lowercase dotted paths (`cache.root`, `quality`)
- CLI flags: kebab-case (`--cache-root`, `--explain`)
- Env vars: `PAIROFCLEATS_*` (secrets only)
