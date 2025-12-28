# Phase 10: Split SQLite Indexes

## Goal
Reduce lock contention and speed up rapid prose updates by splitting SQLite storage into separate code and prose databases.

## Layout
Layout:
- `index-sqlite/index-code.db`
- `index-sqlite/index-prose.db`

## Build behavior
- `npm run build-sqlite-index` builds both DBs.
- `node tools/build-sqlite-index.js --mode code|prose` builds just one DB.

## Search behavior
- `search.js` uses split DBs and the same renderer/scoring.

## Concurrency notes
- Split DBs allow prose-only rebuilds without touching the code DB.
- WAL + read-only search keeps readers isolated while writers rebuild.

## CI artifacts
- CI build/restore scripts now copy both split DBs when present.

## Migration
- Legacy `index.db` files are deleted when rebuilding or cleaning.
