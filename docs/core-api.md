# Core API

PairOfCleats exposes a lightweight programmatic API for build/search/status. Import from `src/core/index.js` in repo-local tooling.

## Functions
- `buildIndex(repoRoot, options)`
  - Builds file-backed indexes (and SQLite if enabled).
  - Options: `mode`, `threads`, `incremental`, `stubEmbeddings`, `sqlite`, `watch`, `watch-poll`, `watch-debounce`, `model`.
- `buildSqliteIndex(repoRoot, options)`
  - Builds or updates SQLite indexes from file-backed artifacts or incremental bundles.
  - Options: `mode`, `incremental`, `compact`, `out`, `codeDir`, `proseDir`.
- `search(repoRoot, params)`
  - Runs search and returns a JSON payload (same shape as `search.js --json`).
  - Params: `query`, `mode`, `backend`, `ann`, `json`, `jsonCompact`, `explain`, plus `args` for raw CLI flags.
- `status(repoRoot, options)`
  - Returns artifact sizes and health hints (same as `report-artifacts --json`).
  - Options: `all` to include all cached repos.

## Example

```js
import { buildIndex, search, status } from '../src/core/index.js';

await buildIndex(process.cwd(), { mode: 'code', sqlite: false, stubEmbeddings: true });
const results = await search(process.cwd(), { query: 'function', mode: 'code', json: true });
const report = await status(process.cwd());
```
