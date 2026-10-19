import assert from 'node:assert/strict';
import path from 'node:path';
import { runNode } from '../helpers/run-node.js';
import { resolveLanes } from './run-discovery.js';
import { loadRunRules } from './run-config.js';

const root = process.cwd();
const rules = loadRunRules({ root });
const lanes = resolveLanes(['all'], rules.knownLanes);
for (const lane of rules.knownLanes) {
  assert.ok(lanes.has(lane), `all must retain tests assigned directly to ${lane}`);
}
const result = runNode([path.join(root, 'tests/run.js'), '--lane', 'all', '--list', '--json'],
  'complete discovery inventory', root, process.env,
  { stdio: 'pipe', spawnOptions: { maxBuffer: 8 * 1024 * 1024 } });
const tests = JSON.parse(result.stdout).tests;
const byId = new Map(tests.map(test => [test.id, test]));
const ordered = runNode([path.join(root, 'tests/run.js'), '--lane', 'ci-long', '--list', '--json'],
  'ordered tokenization inventory', root, process.env,
  { stdio: 'pipe', spawnOptions: { maxBuffer: 8 * 1024 * 1024 } });
const orderedIds = new Set(JSON.parse(ordered.stdout).tests.map(test => test.id));
for (const name of ['identical-config', 'tokenization-config', 'dictionary-config']) {
  const id = `indexing/incremental/tokenization-cache/${name}`;
  assert.ok(byId.has(id) && orderedIds.has(id), `bounded comparison retains discovery and ordered lane membership: ${id}`);
}
const ci = runNode([path.join(root, 'tests/run.js'), '--lane', 'ci', '--list', '--json'],
  'ordered authority and risk inventory', root, process.env,
  { stdio: 'pipe', spawnOptions: { maxBuffer: 8 * 1024 * 1024 } });
const ciIds = new Set(JSON.parse(ci.stdout).tests.map(test => test.id));
for (const id of [
  ...['filters-and-aliases', 'empty-results', 'degraded-artifact', 'invalid-request']
    .map(name => `context-pack/risk-filters-parity/${name}`),
  ...['manifest', 'flow-data'].map(name => `indexing/fixtures/health-authority/${name}`)
]) assert.ok(byId.has(id) && ciIds.has(id), `authority/parity case retains complete and ordered discovery: ${id}`);
for (const id of ['helpers/lane-default-test-config', 'helpers/test-env-clear',
  'indexing/contracts/golden-surface-suite', 'lang/contracts/misc-buildfiles',
  'services/soak/operational-recovery']) {
  assert.ok(byId.has(id), `meaningful regression must be discoverable: ${id}`);
}
assert.equal(byId.get('helpers/lane-default-test-config').lane, 'unit');
assert.ok(!byId.has('fixtures/tooling/suggest-tests/tests/unit/lib'),
  'analyzed fixture input remains excluded from executable test discovery');
console.log('complete discovery retains helper regressions and direct long-lane assignments');
