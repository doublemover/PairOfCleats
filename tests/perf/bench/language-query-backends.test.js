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
assert.deepEqual(zeroStateSkip.backends, ['memory', 'sqlite', 'sqlite-fts']);
assert.equal(zeroStateSkip.skippedSqlite, false);
assert.equal(zeroStateSkip.reason, null);
assert.equal(zeroStateSkip.coverage.selectedSearchModeByBackend.sqlite, 'prose');
assert.equal(zeroStateSkip.coverage.selectedSearchModeByBackend.memory, null);
const codeOnly = resolveBenchQueryBackends({ requestedBackends: ['memory', 'sqlite'],
  sqliteModes: { code: { dbExists: true }, prose: { zeroState: true } } });
assert.deepEqual(codeOnly.backends, ['memory', 'sqlite']);
assert.equal(codeOnly.coverage.selectedSearchModeByBackend.sqlite, 'code', 'rake-shaped code index remains queryable');
assert.deepEqual(codeOnly.coverage.emptySqliteModes, ['prose']);
const allEmpty = resolveBenchQueryBackends({ requestedBackends: ['sqlite', 'fts'],
  sqliteModes: { code: { zeroState: true }, prose: { zeroState: true } } });
assert.deepEqual(allEmpty.backends, []);
assert.equal(allEmpty.emptySqliteWorkload, true);
assert.match(allEmpty.warning, /not exercised/);
assert.deepEqual(allEmpty.coverage.skippedSqliteBackends, ['sqlite', 'fts']);
const explicitCode = resolveBenchQueryBackends({ requestedBackends: ['sqlite'], requestedModes: ['code'],
  sqliteModes: { code: { dbExists: true } } });
assert.equal(explicitCode.reason, null, 'an unrequested missing mode is not required');

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
