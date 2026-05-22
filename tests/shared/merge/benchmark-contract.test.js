import assert from 'node:assert/strict';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';

const root = process.cwd();
const script = path.join(root, 'tools', 'bench', 'merge', 'merge-core-throughput.js');
const result = runNode(
  [script, '--runs', '4', '--run-size', '50'],
  'merge benchmark contract',
  root,
  applyTestEnv({ syncProcess: false }),
  { stdio: 'pipe' }
);

const output = `${result.stdout || ''}${result.stderr || ''}`;
assert.ok(output.includes('[bench] baseline'), 'missing baseline output');
assert.ok(output.includes('[bench] current'), 'missing current output');
assert.ok(output.includes('[bench] delta'), 'missing delta output');

console.log('merge benchmark contract test passed');
