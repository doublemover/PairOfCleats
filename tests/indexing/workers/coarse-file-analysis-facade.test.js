import assert from 'node:assert/strict';
import path from 'node:path';
import { runNode } from '../../helpers/run-node.js';

// AUTHORED: actual facade execution is deferred to the frozen candidate.
const backend = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1) || 'worker';
const flags = backend === 'process' ? ['--max-old-space-size=1024'] : [];
const result = runNode([...flags, path.resolve('tests/indexing/workers/coarse-file-analysis-facade-child.js'), backend],
  'coarse file analysis facade', process.cwd(), process.env, { stdio: 'pipe', allowFailure: true,
    timeoutMs: 20000, spawnOptions: { env: { ...process.env, NODE_OPTIONS: '' } } });
assert.equal(result.status, 0, result.stderr);
const receipt = JSON.parse(result.stdout.trim().split('\n').at(-1));
assert.deepEqual(receipt, { backend, completed: 1 });
console.log(`real ${backend} facade retained full file result and released admission`);
