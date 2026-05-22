#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';

import {
  createSearchBackendFixture,
  parseJsonPayload
} from './helpers/search-backend-scenarios.js';

const fixture = await createSearchBackendFixture('sqlite-search-backend-contract-matrix');
const { tempRoot, searchPath, run } = fixture;

const cases = [
  {
    name: 'auto chooses sqlite when thresholds are met',
    run: () => {
      const result = run(
        [searchPath, 'greet', '--json', '--mode', 'code', '--repo', tempRoot],
        'search auto sqlite threshold',
        { testConfig: { search: { sqliteAutoChunkThreshold: 1 } } }
      );
      assert.equal(parseJsonPayload(result).backend, 'sqlite-fts');
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
      const payload = parseJsonPayload(result);
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
      assert.equal(parseJsonPayload(result).backend, 'sqlite-fts');
    }
  },
  {
    name: 'auto falls back to memory when sqlite artifacts are missing',
    run: async () => {
      const sqlitePaths = fixture.resolveSqlitePaths();
      await fsPromises.rm(sqlitePaths.codePath, { force: true });
      await fsPromises.rm(sqlitePaths.prosePath, { force: true });
      await fsPromises.rm(sqlitePaths.extractedProsePath, { force: true });
      await fsPromises.rm(sqlitePaths.recordsPath, { force: true });
      await fsPromises.rm(sqlitePaths.dbDir, { recursive: true, force: true });

      const result = run(
        [searchPath, 'greet', '--json', '--mode', 'code', '--repo', tempRoot],
        'search auto memory'
      );
      assert.equal(parseJsonPayload(result).backend, 'memory');

      await fixture.restoreSnapshot();
    }
  }
];

for (const testCase of cases) {
  await testCase.run();
}

console.log(`sqlite search backend contract matrix passed (${cases.length} cases)`);
