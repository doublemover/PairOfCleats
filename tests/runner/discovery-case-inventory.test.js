import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../helpers/temp.js';
import { discoverTests } from './run-discovery.js';

const root = await makeTempDir('poc-discovered-cases-');
try {
  await fs.writeFile(path.join(root, 'bounded.test.js'), '// fixture');
  const sidecar = path.join(root, 'bounded.test.js.cases.json');
  const discover = () => discoverTests({ testsDir: root, excludedDirs: new Set(), excludedFiles: new Set() });
  assert.deepEqual((await discover()).map(test => test.id), ['bounded']);
  await fs.writeFile(sidecar, JSON.stringify({ schemaVersion: 1, cases: ['first', 'second'] }));
  const cases = await discover();
  assert.deepEqual(cases.map(test => test.id), ['bounded/first', 'bounded/second']);
  assert.ok(cases.every(test => test.sourceId === 'bounded' && test.path === path.join(root, 'bounded.test.js')));
  for (const ids of [[], ['first', 'first'], ['../escape'], ['nested/case'], [null]]) {
    await fs.writeFile(sidecar, JSON.stringify({ schemaVersion: 1, cases: ids }));
    await assert.rejects(discover(), /Invalid/);
  }
  await fs.writeFile(sidecar, JSON.stringify({ schemaVersion: 0, cases: ['first'] }));
  await assert.rejects(discover(), /Invalid/);
} finally { await rmDirRecursive(root); }
console.log('Explicit fixture cases discover independently and invalid inventories fail closed');
