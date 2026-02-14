#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { buildActions, SCRIPT_COVERAGE_GROUPS } from './actions.js';
import { repoRoot } from '../../helpers/root.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

const root = repoRoot();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const baseCacheRoot = await makeTempDir('pairofcleats-script-coverage-parity-');
const mergeDir = path.join(baseCacheRoot, 'merge');
await fsPromises.mkdir(mergeDir, { recursive: true });

const scripts = JSON.parse(await fsPromises.readFile(path.join(root, 'package.json'), 'utf8')).scripts || {};
const scriptNames = new Set(Object.keys(scripts));
const groups = new Set(SCRIPT_COVERAGE_GROUPS);

const actions = await buildActions({
  root,
  fixtureRoot,
  repoEnv: { ...process.env },
  baseCacheRoot,
  mergeDir,
  runNode: () => {},
  scriptNames
});

const unknown = new Set();
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
}

await rmDirRecursive(baseCacheRoot);
assert.equal(unknown.size, 0, `expected covers to align with package scripts (unknown: ${Array.from(unknown).join(', ')})`);
assert.equal(hasHarnessAction, true, 'expected dedicated script-coverage harness action');

console.log('script coverage harness parity test passed');
