import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const script = path.join(root, 'tools', 'bench', 'index', 'file-meta-compare.js');
const result = spawnSync(process.execPath, [script, '--files', '2000', '--iterations', '1', '--mode', 'compare'], {
  cwd: root,
  encoding: 'utf8'
});

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
