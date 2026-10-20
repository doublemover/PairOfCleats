import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runNode } from '../../helpers/run-node.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = process.cwd();
const policy = runNode([path.join(root, 'tools/tooling/python-check.js'), '--json'],
  'Python for minimum editor API compatibility', root, applyTestEnv({ syncProcess: false }), { stdio: 'pipe' });
assert.equal(policy.status, 0, policy.stderr);
const python = JSON.parse(policy.stdout).python;
const result = spawnSync(python, ['-E', '-S', path.join(root, 'tests/helpers/sublime/runtime_compatibility.py')],
  { cwd: root, encoding: 'utf8', timeout: 10000, windowsHide: true });
assert.equal(result.error, undefined, String(result.error));
assert.equal(result.status, 0, result.stderr);
assert.match(result.stderr, /Ran 4 tests/);
assert.match(result.stderr, /\bOK\b/);
console.log('Minimum editor API compatibility preserves contained watch roots and bounded cancellation/timeout cleanup.');
