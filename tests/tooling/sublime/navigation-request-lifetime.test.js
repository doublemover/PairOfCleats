import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { runNode } from '../../helpers/run-node.js';

// Authored entry only; no Python, child or editor execution during source work.
const root = process.cwd();
const policy = runNode(['tools/tooling/python-check.js', '--json'], 'Sublime Python policy', root, process.env, { stdio: 'pipe' });
const { python } = JSON.parse(policy.stdout);
const result = spawnSync(python, ['tests/helpers/sublime/navigation_request_lifetime.py'], { cwd: root, windowsHide: true, encoding: 'utf8', timeout: 8000 });
assert.equal(result.status, 0, result.stderr || result.error?.message);
assert.match(result.stdout, /Sublime original request\/picker\/deferred target controls authored/);
console.log('Sublime request/picker/deferred target controls authored; execution deferred during implementation.');
