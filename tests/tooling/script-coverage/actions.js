import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { buildBenchmarkActions } from './actions/benchmarks.js';
import { buildCoreActions } from './actions/core.js';
import { buildEmbeddingActions } from './actions/embeddings.js';
import { buildFixtureActions } from './actions/fixtures.js';
import { buildIndexingActions } from './actions/indexing.js';
import { buildLanguageActions } from './actions/language.js';
import { buildSearchActions } from './actions/search.js';
import { buildServiceActions } from './actions/services.js';
import { buildStorageActions } from './actions/storage.js';
import { buildToolActions } from './actions/tools.js';

export const buildActions = async (context) => {
  const { root, fixtureRoot, repoEnv, baseCacheRoot, runNode } = context;
  const ciOutDir = context.ciOutDir || path.join(baseCacheRoot, 'ci-artifacts');
  const skipSqliteIncremental = process.env.PAIROFCLEATS_SKIP_SQLITE_INCREMENTAL === '1'
    || process.env.PAIROFCLEATS_SKIP_SQLITE_INCREMENTAL === 'true';
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
    ciOutDir,
    skipSqliteIncremental
  };

  const actions = [
    ...buildCoreActions(actionContext),
    ...buildStorageActions(actionContext),
    ...buildIndexingActions(actionContext),
    ...buildLanguageActions(actionContext),
    ...buildBenchmarkActions(actionContext),
    ...buildSearchActions(actionContext),
    ...buildEmbeddingActions(actionContext),
    ...buildServiceActions(actionContext),
    ...buildFixtureActions(actionContext),
    ...buildToolActions(actionContext)
  ];

  const mergeDir = context.mergeDir || path.join(baseCacheRoot, 'merge');
  await fsPromises.mkdir(mergeDir, { recursive: true });
  const mergeBase = path.join(mergeDir, 'base.txt');
  const mergeTarget = path.join(mergeDir, 'target.txt');
  await fsPromises.writeFile(mergeBase, 'alpha\nbeta\n');
  await fsPromises.writeFile(mergeTarget, 'beta\ngamma\n');

  if (scriptNames) {
    const filtered = actions.map((action) => ({
      ...action,
      covers: filterCovers(action.covers),
      coversTierB: filterCovers(action.coversTierB)
    }));
    return filtered.filter((action) => (
      action.alwaysRun === true
      || (Array.isArray(action.covers) && action.covers.length > 0)
      || (Array.isArray(action.coversTierB) && action.coversTierB.length > 0)
    ));
  }
  return actions;
};
