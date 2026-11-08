import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../helpers/temp.js';
import { runNode } from '../helpers/run-node.js';
import { applyTestEnv } from '../helpers/test-env.js';

const root = process.cwd(), dir = await makeTempDir('exact-test-selection-');
const env = applyTestEnv({ syncProcess: false, extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
const file = path.join(dir, 'ids.json'), id = 'runner/harness/coverage-merge';
const execute = args => runNode(['tests/run.js', '--lane', 'all', '--test-id-file', file, ...args],
  'exact selection owner', root, env, { stdio: 'pipe', allowFailure: true, timeoutMs: 10000 });
try {
  await fs.writeFile(file, JSON.stringify({ schemaVersion: 1, ids: [id] }));
  const list = execute(['--list', '--json']); assert.equal(list.status, 0, list.stderr);
  assert.deepEqual(JSON.parse(list.stdout).tests.map(test => test.id), [id]);
  const narrowed = execute(['--match', '/^cli\//', '--list']);
  assert.equal(narrowed.status, 1); assert.match(narrowed.stderr, /outside the current selection/);
  await fs.writeFile(file, JSON.stringify({ schemaVersion: 1, ids: ['not/a/discovered/test'] }));
  const missing = execute(['--list']); assert.equal(missing.status, 1); assert.match(missing.stderr, /outside the current selection/);
  await fs.writeFile(file, JSON.stringify({ schemaVersion: 1, ids: [id] }));
  const coverage = path.join(dir, 'coverage.json');
  const actual = execute(['--jobs', '1', '--timeout-ms', '30000', '--retries', '0', '--native-status-redo=false', '--coverage', coverage]);
  assert.equal(actual.status, 0, actual.stderr);
  const summary = JSON.parse(await fs.readFile(coverage)), ranges = JSON.parse(await fs.readFile(coverage + '.ranges.json'));
  assert.equal(summary.sourcePlatform, process.platform); assert.equal(ranges.sourcePlatform, process.platform);
  assert.ok(ranges.entries.length > 0, 'the real bounded child emits original V8 ranges');
} finally { await rmDirRecursive(dir); }
console.log('Exact ID files narrow normal runner discovery and retain real child coverage.');
