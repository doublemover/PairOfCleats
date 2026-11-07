import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { runNode } from '../../helpers/run-node.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = process.cwd();
const policy = runNode(['tools/tooling/python-check.js', '--json'], 'Sublime root registration Python',
  root, applyTestEnv({ syncProcess: false }), { stdio: 'pipe' });
assert.equal(policy.status, 0, policy.stderr);
const { python } = JSON.parse(policy.stdout);
const result = spawnSync(python, ['-E', '-S', 'tests/helpers/sublime/root_command_registration.py'],
  { cwd: root, encoding: 'utf8', timeout: 8000, windowsHide: true });
assert.equal(result.error, undefined, String(result.error));
assert.equal(result.status, 0, result.stderr);
assert.match(result.stderr, /Ran 2 tests/);
assert.match(result.stderr, /\bOK\b/);
console.log('Sublime root discovery exposes advertised commands once and refreshes only owned aliases.');
