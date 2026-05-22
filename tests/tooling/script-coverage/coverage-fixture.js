import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { repoRoot } from '../../helpers/root.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { buildActions } from './actions.js';

export const createScriptCoverageActionsFixture = async () => {
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

  const cleanup = () => rmDirRecursive(baseCacheRoot);
  return {
    root,
    fixtureRoot,
    baseCacheRoot,
    mergeDir,
    scripts,
    scriptNames,
    actions,
    cleanup
  };
};

export const collectUnknownActionCovers = (actions, scriptNames) => {
  const unknown = new Set();
  for (const action of actions) {
    for (const key of ['covers', 'coversTierB']) {
      const values = Array.isArray(action[key]) ? action[key] : [];
      for (const name of values) {
        if (!scriptNames.has(name)) unknown.add(name);
      }
    }
  }
  return unknown;
};
