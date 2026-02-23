#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { resolveBenchQueryBackends } from '../../../tools/bench/language/query-backends.js';

ensureTestingEnv(process.env);

const available = resolveBenchQueryBackends({
  requestedBackends: ['memory', 'sqlite'],
  sqliteModes: {
    code: { dbExists: true, zeroState: false },
    prose: { dbExists: true, zeroState: false }
  },
  sqlitePaths: {
    code: 'C:/cache/index-code.db',
    prose: 'C:/cache/index-prose.db'
  }
});
assert.deepEqual(available.backends, ['memory', 'sqlite']);
assert.equal(available.skippedSqlite, false);
assert.equal(available.reason, null);

const zeroStateSkip = resolveBenchQueryBackends({
  requestedBackends: ['memory', 'sqlite', 'sqlite-fts'],
  sqliteModes: {
    code: { dbExists: false, zeroState: true },
    prose: { dbExists: true, zeroState: false }
  },
  sqlitePaths: {
    code: 'C:/cache/index-code.db',
    prose: 'C:/cache/index-prose.db'
  }
});
assert.deepEqual(zeroStateSkip.backends, ['memory']);
assert.equal(zeroStateSkip.skippedSqlite, true);
assert.match(zeroStateSkip.reason, /zero-state/i);

const hardMissing = resolveBenchQueryBackends({
  requestedBackends: ['memory', 'sqlite'],
  sqliteModes: {
    code: { dbExists: false, zeroState: false },
    prose: { dbExists: true, zeroState: false }
  },
  sqlitePaths: {
    code: 'C:/cache/index-code.db',
    prose: 'C:/cache/index-prose.db'
  }
});
assert.deepEqual(hardMissing.backends, ['memory', 'sqlite']);
assert.equal(hardMissing.skippedSqlite, false);
assert.match(hardMissing.reason, /missing/i);
assert.match(hardMissing.reason, /index-code\.db/i);

console.log('bench-language query backend filtering test passed');
