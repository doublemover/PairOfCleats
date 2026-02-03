# Core API

PairOfCleats exposes a lightweight programmatic API for build/search/status. Import from `src/integrations/core/index.js` in repo-local tooling.

## Functions
- `buildIndex(repoRoot, options)`
  - Builds file-backed indexes (and SQLite if enabled).
  - Build options mirror `build_index.js` (see `src/shared/cli-options.js` → `INDEX_BUILD_OPTIONS`).
  - Common options: `mode`, `modes`, `quality`, `stage`, `dims`, `threads`, `incremental`, `stubEmbeddings`,
    `sqlite`, `watch`, `watch-poll`, `watch-debounce`, `model`, `repo`,
    `scm-provider`, `scm-annotate`, `no-scm-annotate`, `progress`,
    `config-dump`, `log-file`, `log-format`, `json`, `verbose`, `quiet`.
  - Advanced options: `rawArgv`, `log`, `logError`, `warn`, `abortSignal`, `emitOutput`.
- `buildSqliteIndex(repoRoot, options)`
  - Builds or updates SQLite indexes from file-backed artifacts or incremental bundles.
  - Options: `mode`, `incremental`, `compact`, `out`, `codeDir`, `proseDir`, `extractedProseDir`, `recordsDir`, `args`.
  - Execution options: `emitOutput`, `exitOnError`, `logger`.
- `search(repoRoot, params)`
  - Runs search and returns a JSON payload (same shape as `pairofcleats search --json`).
  - Params mapped to CLI flags: `query`, `mode`, `backend`, `ann`, `annBackend`, `context`, `n`, `case`, `caseFile`,
    `caseTokens`, `path`, `file`, `ext`, `lang`, `json`, `explain`.
  - Use `args` to pass any other CLI flags (for example `--compact`, `--top`, `--filter`, `--meta`, `--meta-json`).
  - Execution options: `emitOutput`, `exitOnError`, `indexCache`, `sqliteCache`, `signal`, `scoreMode`, `root`.
- `status(repoRoot, options)`
  - Returns artifact sizes and health hints (core status payload from `src/integrations/core/status.js`).
  - Options: `includeAll` to include all cached repos.

## Example

```js
import { buildIndex, search, status } from '../src/integrations/core/index.js';

await buildIndex(process.cwd(), { mode: 'code', sqlite: false, stubEmbeddings: true });
const results = await search(process.cwd(), { query: 'function', mode: 'code', json: true });
const report = await status(process.cwd());
```
