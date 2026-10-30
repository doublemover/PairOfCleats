import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { runNode } from '../../helpers/run-node.js';

const root = process.cwd();
const policy = runNode(['tools/tooling/python-check.js', '--json'], 'Sublime bounded HTTP reader', root, process.env, { stdio: 'pipe' });
assert.equal(policy.status, 0, policy.stderr);
const { python } = JSON.parse(policy.stdout);
const result = spawnSync(python, ['-E', '-S', 'tests/helpers/sublime/api_response_bytes.py'], {
  cwd: root, encoding: 'utf8', timeout: 8000, windowsHide: true
});
assert.equal(result.error, undefined, String(result.error));
assert.equal(result.status, 0, result.stderr);
assert.match(result.stderr, /Ran 5 tests/);
assert.match(result.stderr, /\bOK\b/);
console.log('Sublime HTTP response admission, cancellation and closure controls passed.');
