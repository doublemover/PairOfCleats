import path from 'node:path';
import { buildFixtureActions } from './actions/fixtures.js';
import { buildIndexingActions } from './actions/indexing.js';
import { buildStorageActions } from './actions/storage.js';
import { buildToolActions } from './actions/tools.js';

export const SCRIPT_COVERAGE_GROUPS = Object.freeze([
  'storage',
  'indexing',
  'fixtures',
  'tools'
]);

const withGroup = (group, actions) => (
  (actions || []).map((action) => ({ ...action, group: action.group || group }))
);

export const buildActions = async (context) => {
  const { root, fixtureRoot, repoEnv, baseCacheRoot, runNode } = context;
  const ciOutDir = context.ciOutDir || path.join(baseCacheRoot, 'ci-artifacts');
  const scriptNames = context.scriptNames instanceof Set ? context.scriptNames : null;
  const filterCovers = (covers) => {
    if (!scriptNames || !Array.isArray(covers)) return covers;
    return covers.filter((name) => scriptNames.has(name));
  };

  const actionContext = {
    ...context,
    root,
    fixtureRoot,
    repoEnv,
    baseCacheRoot,
    runNode,
    ciOutDir
  };

  const actions = [
    ...withGroup('storage', buildStorageActions(actionContext)),
    ...withGroup('indexing', buildIndexingActions(actionContext)),
    ...withGroup('fixtures', buildFixtureActions(actionContext)),
    ...withGroup('tools', buildToolActions(actionContext))
  ];

  if (scriptNames) {
    const filtered = actions.map((action) => ({
      ...action,
      covers: filterCovers(action.covers),
      coversTierB: filterCovers(action.coversTierB)
    }));
    return filtered;
  }
  return actions;
};
