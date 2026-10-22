import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { runNode } from '../../helpers/run-node.js';

const root = process.cwd();
const policy = runNode(['tools/tooling/python-check.js', '--json'], 'Sublime Python policy', root, process.env, { stdio: 'pipe' });
const { python } = JSON.parse(policy.stdout);
const result = spawnSync(python, ['tests/helpers/sublime/operation_ownership.py'], {
  cwd: root, encoding: 'utf8', timeout: 8000
});
assert.equal(result.status, 0, result.stderr || result.error?.message);
assert.match(result.stdout, /Sublime owned process\/HTTP disposal, queued UI fencing and window\/request isolation passed/);
console.log('Sublime extension-wide operation ownership fixture passed.');
