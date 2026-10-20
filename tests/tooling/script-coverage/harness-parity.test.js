#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { buildActions, SCRIPT_COVERAGE_GROUPS } from './actions.js';
import { repoRoot } from '../../helpers/root.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { buildScriptCoverageCaseInventories } from './case-inventory.js';

const root = repoRoot();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const baseCacheRoot = await makeTempDir('pairofcleats-script-coverage-parity-');
const mergeDir = path.join(baseCacheRoot, 'merge');
await fsPromises.mkdir(mergeDir, { recursive: true });

const scripts = JSON.parse(await fsPromises.readFile(path.join(root, 'package.json'), 'utf8')).scripts || {};
const scriptNames = new Set(Object.keys(scripts));
const groups = new Set(SCRIPT_COVERAGE_GROUPS);
const invocations = [];

const actions = await buildActions({
  root,
  fixtureRoot,
  repoEnv: { ...process.env },
  baseCacheRoot,
  mergeDir,
  runNode: (label, script, args = [], options = {}) => { invocations.push({ label, script, args, options }); },
  scriptNames
});
for (const [group, expected] of Object.entries(buildScriptCoverageCaseInventories(actions))) {
  const filename = path.join(root, 'tests/tooling/script-coverage', `${group}.test.js.cases.json`);
  assert.deepEqual(JSON.parse(await fsPromises.readFile(filename, 'utf8')), expected,
    `every ${group} action retains its own discovered process boundary`);
}

const unknown = new Set();
const commandMismatches = [];
const signatures = new Map(), duplicateInvocations = [];
let hasHarnessAction = false;
for (const action of actions) {
  assert.ok(groups.has(action.group), `unexpected script-coverage group: ${action.group}`);
  if (action.label === 'script-coverage-harness-test') hasHarnessAction = true;
  for (const key of ['covers', 'coversTierB']) {
    const values = Array.isArray(action[key]) ? action[key] : [];
    for (const name of values) {
      if (!scriptNames.has(name)) unknown.add(name);
    }
  }
  const claims = [...new Set([...(action.covers || []), ...(action.coversTierB || [])])];
  invocations.length = 0;
  await action.run();
  const signature = JSON.stringify(invocations.map(({ script, args, options }) => ({ script, args, options })));
  if (signatures.has(signature)) duplicateInvocations.push([signatures.get(signature), `${action.group}/${action.label}`]);
  else signatures.set(signature, `${action.group}/${action.label}`);
  if (claims.length) {
    const actual = invocations.length === 1
      ? ['node', path.relative(root, invocations[0].script).replace(/\\/g, '/'), ...invocations[0].args].join(' ')
      : `${invocations.length} separate invocations`;
    for (const name of claims) if (scripts[name] !== actual) {
      commandMismatches.push({ action: action.label, claim: name, expected: scripts[name], actual });
    }
  }
}

await rmDirRecursive(baseCacheRoot);
assert.deepEqual(commandMismatches, [], 'a partial smoke command must not claim execution of a different npm command');
assert.deepEqual(duplicateInvocations, [], 'identical subprocess inputs/options cannot have duplicate wrapper aliases');
assert.equal(unknown.size, 0, `expected covers to align with package scripts (unknown: ${Array.from(unknown).join(', ')})`);
assert.equal(hasHarnessAction, true, 'expected dedicated script-coverage harness action');

console.log('script coverage harness parity test passed');
