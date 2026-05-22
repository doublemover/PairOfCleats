#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  createSearchBackendFixture,
  parseJsonPayload
} from './helpers/search-backend-scenarios.js';

const fixture = await createSearchBackendFixture('sqlite-search-backend-disabled-dependency');
const { tempRoot, searchPath, run } = fixture;

const cases = [
  {
    name: 'auto falls back to memory when sqlite dependency is disabled',
    run: () => {
      const result = run(
        [searchPath, 'greet', '--json', '--mode', 'code', '--repo', tempRoot],
        'search auto with sqlite disabled',
        { extraEnv: { NODE_OPTIONS: '--no-addons' } }
      );
      assert.equal(parseJsonPayload(result).backend, 'memory');
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
        message = parseJsonPayload(result)?.message || '';
      } catch {
        message = stderr;
      }
      assert.match(message || stdout || stderr, /better-sqlite3 is required/);
    }
  }
];

for (const testCase of cases) {
  await testCase.run();
}

console.log(`sqlite search backend disabled dependency contract passed (${cases.length} cases)`);
