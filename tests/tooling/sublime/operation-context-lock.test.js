import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { runNode } from '../../helpers/run-node.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const policy = runNode(['tools/tooling/python-check.js', '--json'], 'Sublime context lock Python',
  process.cwd(), applyTestEnv({ syncProcess: false }), { stdio: 'pipe' });
assert.equal(policy.status, 0, policy.stderr);
const result = spawnSync(JSON.parse(policy.stdout).python, ['-E', '-S', 'tests/helpers/sublime/operation_context_lock.py'],
  { cwd: process.cwd(), encoding: 'utf8', timeout: 10000, windowsHide: true });
assert.equal(result.error, undefined, String(result.error));
assert.equal(result.status, 0, result.stderr);
assert.match(result.stderr, /Ran 5 tests/); assert.match(result.stderr, /\bOK\b/);
console.log('Editor context reads release shared locks while original epochs and progress intent remain fenced.');
