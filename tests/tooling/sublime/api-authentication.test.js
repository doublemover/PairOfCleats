import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { prepareFixtureApiServerCohort } from '../../helpers/api-server.js';
import { runNode } from '../../helpers/run-node.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = process.cwd();
const policy = runNode([path.join(root, 'tools/tooling/python-check.js'), '--json'],
  'Python for destination-bound editor API authentication', root, applyTestEnv({ syncProcess: false }), { stdio: 'pipe' });
assert.equal(policy.status, 0, policy.stderr);
const python = JSON.parse(policy.stdout).python;
const helper = path.join(root, 'tests/helpers/sublime/api_authentication.py');
const control = spawnSync(python, ['-E', '-S', helper],
  { cwd: root, encoding: 'utf8', timeout: 5000, windowsHide: true });
assert.equal(control.error, undefined, String(control.error));
assert.equal(control.status, 0, control.stderr);
assert.match(control.stderr, /Ran 5 tests/);
assert.match(control.stderr, /\bOK\b/);

const cohort = await prepareFixtureApiServerCohort({ cacheName: 'sublime-api-authentication',
  fixtureOptions: { requiredModes: ['code'], buildStage: 'stage1' } });
const token = 'fixture-sublime-authentication-token';
const { serverInfo, stop } = await cohort.start({ authToken: token });
try {
  const result = spawnSync(python, ['-E', '-S', helper, '--real-api',
    `http://${serverInfo.host}:${serverInfo.port}`, cohort.fixtureRoot, token],
  { cwd: root, encoding: 'utf8', timeout: 10000, windowsHide: true });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Real authenticated API search, health, status and wrong-token rejection passed/);
  assert.equal(result.stderr, '');
} finally {
  await stop();
}
console.log('Sublime API credentials use user-approved origins, refuse redirects and authenticate real API workflows.');
