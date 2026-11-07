import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { runNode } from '../../helpers/run-node.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const policy = runNode(['tools/tooling/python-check.js', '--json'], 'Sublime project save Python',
  process.cwd(), applyTestEnv({ syncProcess: false }), { stdio: 'pipe' });
assert.equal(policy.status, 0, policy.stderr);
const result = spawnSync(JSON.parse(policy.stdout).python, ['-E', '-S', 'tests/helpers/sublime/project_save_authority.py'],
  { cwd: process.cwd(), encoding: 'utf8', timeout: 8000, windowsHide: true });
assert.equal(result.error, undefined, String(result.error));
assert.equal(result.status, 0, result.stderr);
assert.match(result.stderr, /Ran 7 tests/);
assert.match(result.stderr, /\bOK\b/);
console.log('Native project saves preserve unchanged search scopes and revoke changed or reloaded source contexts.');
