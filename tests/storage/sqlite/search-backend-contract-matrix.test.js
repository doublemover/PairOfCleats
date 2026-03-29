#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { applyTestEnv } from '../../helpers/test-env.js';
import { runSqliteBuild } from '../../helpers/sqlite-builder.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { resolveSqlitePaths } from '../../../tools/shared/dict-utils.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'sqlite-search-backend-contract-matrix');
const cacheRoot = path.join(tempRoot, '.cache');
const searchPath = path.join(root, 'search.js');
const buildIndexPath = path.join(root, 'build_index.js');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });

const sampleCode = `
export function greet(name) {
  return "hello " + name;
}
`;
await fsPromises.writeFile(path.join(tempRoot, 'sample.js'), sampleCode);

const buildTestEnv = (testConfig = null, extraEnv = {}) => applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: testConfig ?? null,
  extraEnv: {
    PAIROFCLEATS_WORKER_POOL: 'off',
    ...extraEnv
  }
});

const run = (args, label, { testConfig = null, extraEnv = {}, allowFailure = false } = {}) => {
  const result = spawnSync(process.execPath, args, {
    cwd: tempRoot,
    env: buildTestEnv(testConfig, extraEnv),
    encoding: 'utf8'
  });
  if (result.status !== 0 && !allowFailure) {
    console.error(`Failed: ${label}`);
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
  return result;
};

run([buildIndexPath, '--stub-embeddings', '--repo', tempRoot], 'build index');
await runSqliteBuild(tempRoot, { mode: 'code' });

const cases = [
  {
    name: 'auto chooses sqlite when thresholds are met',
    run: () => {
      const result = run(
        [searchPath, 'greet', '--json', '--mode', 'code', '--repo', tempRoot],
        'search auto sqlite threshold',
        { testConfig: { search: { sqliteAutoChunkThreshold: 1 } } }
      );
      const backend = JSON.parse(result.stdout || '{}').backend;
      assert.equal(backend, 'sqlite-fts');
    }
  },
  {
    name: 'auto stays on memory when thresholds are not met',
    run: () => {
      const result = run(
        [searchPath, 'greet', '--json', '--stats', '--mode', 'code', '--repo', tempRoot],
        'search auto memory threshold',
        { testConfig: { search: { sqliteAutoChunkThreshold: 9999 } } }
      );
      const payload = JSON.parse(result.stdout || '{}');
      assert.equal(payload.backend, 'memory');
      assert.match(String(payload?.stats?.backendPolicy?.reason || ''), /thresholds not met/);
    }
  },
  {
    name: 'zero thresholds force sqlite auto backend',
    run: () => {
      const result = run(
        [searchPath, 'greet', '--json', '--mode', 'code', '--repo', tempRoot],
        'search auto sqlite threshold disabled',
        { testConfig: { search: { sqliteAutoChunkThreshold: 0, sqliteAutoArtifactBytes: 0 } } }
      );
      const backend = JSON.parse(result.stdout || '{}').backend;
      assert.equal(backend, 'sqlite-fts');
    }
  },
  {
    name: 'auto falls back to memory when sqlite artifacts are missing',
    run: async () => {
      const sqlitePaths = resolveSqlitePaths(tempRoot, null);
      await fsPromises.rm(sqlitePaths.codePath, { force: true });
      await fsPromises.rm(sqlitePaths.prosePath, { force: true });
      await fsPromises.rm(sqlitePaths.extractedProsePath, { force: true });
      await fsPromises.rm(sqlitePaths.recordsPath, { force: true });
      await fsPromises.rm(sqlitePaths.dbDir, { recursive: true, force: true });

      const result = run(
        [searchPath, 'greet', '--json', '--mode', 'code', '--repo', tempRoot],
        'search auto memory'
      );
      const backend = JSON.parse(result.stdout || '{}').backend;
      assert.equal(backend, 'memory');

      await runSqliteBuild(tempRoot, { mode: 'code' });
    }
  },
  {
    name: 'auto falls back to memory when sqlite dependency is disabled',
    run: () => {
      const result = run(
        [searchPath, 'greet', '--json', '--mode', 'code', '--repo', tempRoot],
        'search auto with sqlite disabled',
        { extraEnv: { NODE_OPTIONS: '--no-addons' } }
      );
      const backend = JSON.parse(result.stdout || '{}').backend;
      assert.equal(backend, 'memory');
    }
  },
  {
    name: 'forced sqlite fails closed when sqlite dependency is disabled',
    run: () => {
      const result = run(
        [searchPath, 'greet', '--json', '--mode', 'code', '--backend', 'sqlite', '--repo', tempRoot],
        'search forced sqlite with sqlite disabled',
        { extraEnv: { NODE_OPTIONS: '--no-addons' }, allowFailure: true }
      );
      assert.notEqual(result.status, 0, 'expected forced sqlite search to fail when sqlite is disabled');
      const stdout = String(result.stdout || '').trim();
      const stderr = String(result.stderr || '').trim();
      let message = '';
      try {
        message = JSON.parse(stdout)?.message || '';
      } catch {
        message = stderr;
      }
      assert.match(message, /better-sqlite3 is required/);
    }
  }
];

for (const testCase of cases) {
  await testCase.run();
}

console.log(`sqlite search backend contract matrix passed (${cases.length} cases)`);
