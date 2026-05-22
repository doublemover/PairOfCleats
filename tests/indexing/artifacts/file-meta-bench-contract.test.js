import assert from 'node:assert/strict';
import path from 'node:path';
import { runNode } from '../../helpers/run-node.js';

const root = process.cwd();
const script = path.join(root, 'tools', 'bench', 'index', 'file-meta-compare.js');
const result = runNode(
  [script, '--files', '2000', '--iterations', '1', '--mode', 'compare'],
  'file meta bench contract',
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

console.log('file meta bench contract test passed');
