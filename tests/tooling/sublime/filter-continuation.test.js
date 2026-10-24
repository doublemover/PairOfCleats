import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { runNode } from '../../helpers/run-node.js';
const root = process.cwd();
const policy = runNode(['tools/tooling/python-check.js', '--json'], 'Sublime Python policy', root, process.env, { stdio: 'pipe' });
const { python } = JSON.parse(policy.stdout);
const result = spawnSync(python, ['tests/helpers/sublime/filter_continuation.py'],
  { cwd: root, encoding: 'utf8', timeout: 8000 });
assert.equal(result.status, 0, result.stderr || result.error?.message);
assert.match(result.stdout, /Sublime indexed continuation pins endpoint, generation and exact hit identity without cross-transport replay/);
console.log('Sublime canonical continuation admission and destination ownership controls passed');
