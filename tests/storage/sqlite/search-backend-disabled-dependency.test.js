#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createSearchBackendFixture, parseJsonPayload } from './helpers/search-backend-scenarios.js';

const { tempRoot, searchPath, run } = await createSearchBackendFixture('sqlite-search-backend-disabled-dependency');
// SQLite is required by the prepared runtime. --no-addons invalidates readiness
// for every CLI backend, so it cannot be used to simulate optional SQLite loss.
for (const backend of ['auto', 'sqlite']) {
  const result = run([searchPath, 'greet', '--json', '--mode', 'code', '--backend', backend, '--repo', tempRoot],
    'native-disabled startup ' + backend, { extraEnv: { NODE_OPTIONS: '--no-addons' }, allowFailure: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /BOOTSTRAP REQUIRED/);
  assert.match(result.stderr, /better-sqlite3 is not usable/);
  assert.equal(result.stdout.trim(), '', 'failed readiness cannot masquerade as search output');
}
const memory = run([searchPath, 'greet', '--json', '--mode', 'code', '--backend', 'memory', '--no-ann', '--repo', tempRoot],
  'prepared memory backend');
const payload = parseJsonPayload(memory);
assert.equal(payload.backend, 'memory');
assert.ok(payload.code.length > 0, 'explicit memory retrieval remains covered in the prepared runtime');
console.log('Native-disabled startup fails closed and prepared memory retrieval remains usable');
