import assert from 'node:assert/strict';
import path from 'node:path';
import { runNode } from '../../helpers/run-node.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const script = path.join(root, 'tools', 'bench', 'index', 'minhash-packed.js');
const result = runNode(
  [script, '--count', '2000', '--dims', '32', '--mode', 'compare'],
  'minhash packed bench contract',
  root,
  process.env,
  { stdio: 'pipe', allowFailure: true }
);

if (result.status !== 0) {
  console.error(result.stdout || '');
  console.error(result.stderr || '');
  process.exit(1);
}

const output = `${result.stdout || ''}${result.stderr || ''}`;
assert.ok(output.includes('[bench] baseline'), 'missing baseline output');
assert.ok(output.includes('[bench] current'), 'missing current output');
assert.ok(output.includes('[bench] delta'), 'missing delta output');

console.log('minhash packed bench contract test passed');
