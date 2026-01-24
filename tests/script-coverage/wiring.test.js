#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { buildActions } from './actions.js';
import { repoRoot } from '../helpers/root.js';
import { makeTempDir, rmDirRecursive } from '../helpers/temp.js';

const root = repoRoot();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const baseCacheRoot = await makeTempDir('pairofcleats-script-coverage-');
const mergeDir = path.join(baseCacheRoot, 'merge');
await fsPromises.mkdir(mergeDir, { recursive: true });

const scripts = JSON.parse(await fsPromises.readFile(path.join(root, 'package.json'), 'utf8')).scripts || {};
const scriptNames = new Set(Object.keys(scripts));

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
for (const action of actions) {
  for (const key of ['covers', 'coversTierB']) {
    const values = Array.isArray(action[key]) ? action[key] : [];
    for (const name of values) {
      if (!scriptNames.has(name)) unknown.add(name);
    }
  }
}

if (unknown.size) {
  console.error(`script coverage wiring invalid: ${Array.from(unknown).sort().join(', ')}`);
  process.exit(1);
}

await rmDirRecursive(baseCacheRoot);
console.log('script coverage wiring test passed');
