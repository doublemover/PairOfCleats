# Command Surface

PairOfCleats uses the `pairofcleats` CLI as the primary interface. `npm run <script>`
wrappers remain available for CI or local convenience, but the list is intentionally
small. If the binary is not on your PATH, use `node bin/pairofcleats.js`.


## Core
- `pairofcleats setup`
- `pairofcleats bootstrap`

## Index
- `pairofcleats index build`
- `pairofcleats index watch`
- `pairofcleats index validate`

## Search
- `pairofcleats search`

## Service
- `pairofcleats service api`

## LMDB
- `pairofcleats lmdb build`

Other tooling remains available as direct `node tools/...` scripts but is not part of the
public CLI surface.

## Tests
- `npm run test`
- `npm run test:smoke` / `npm run test:unit` / `npm run test:integration`
- `npm run test:services` / `npm run test:storage` / `npm run test:perf` / `npm run test:ci`
- `npm run test:list`
- `npm run verify`

Use `node tests/run.js --list` to see the resolved test IDs for your filters.
