import path from 'node:path';
import { resolveAsOfContext, resolveSingleRootForModes } from '../../../../index/as-of.js';
import { getIndexDir, resolveIndexRoot } from '../../../../shared/dict-utils.js';

const SQLITE_MODE_ORDER = Object.freeze(['code', 'prose', 'extracted-prose', 'records']);
const MODE_PLAN_CACHE_LIMIT = 64;
const modePlanCache = new Map();

const readModePlanCache = (cacheKey) => {
  const cached = modePlanCache.get(cacheKey);
  if (!cached) return null;
  modePlanCache.delete(cacheKey);
  modePlanCache.set(cacheKey, cached);
  return {
    ...cached,
    modeList: [...cached.modeList],
    explicitDirs: { ...cached.explicitDirs },
    modeIndexDirs: { ...cached.modeIndexDirs }
  };
};

const writeModePlanCache = (cacheKey, plan) => {
  if (!cacheKey || !plan) return;
  if (modePlanCache.has(cacheKey)) {
    modePlanCache.delete(cacheKey);
  }
  modePlanCache.set(cacheKey, {
    ...plan,
    modeList: [...plan.modeList],
    explicitDirs: { ...plan.explicitDirs },
    modeIndexDirs: { ...plan.modeIndexDirs }
  });
  while (modePlanCache.size > MODE_PLAN_CACHE_LIMIT) {
    const oldestKey = modePlanCache.keys().next().value;
    modePlanCache.delete(oldestKey);
  }
};

const createModePlanCacheKey = ({
  root,
  modeArg,
  argv,
  options,
  runtime,
  defaultIndexRoot
}) => [
  root || '',
  modeArg || 'all',
  argv?.['index-root'] || '',
  options?.indexRoot || '',
  runtime?.buildRoot || '',
  defaultIndexRoot || '',
  argv?.['code-dir'] || '',
  argv?.['prose-dir'] || '',
  argv?.['extracted-prose-dir'] || '',
  argv?.['records-dir'] || '',
  options?.codeDir || '',
  options?.proseDir || '',
  options?.extractedProseDir || '',
  options?.recordsDir || ''
].join('|');

export const resolveModeList = (modeArg) => (
  modeArg === 'all' ? [...SQLITE_MODE_ORDER] : [modeArg]
);

/**
 * Resolve mode ordering and index directory plan for sqlite builds.
 * @param {object} options
 * @returns {object}
 */
export const resolveModeExecutionPlan = ({
  modeArg,
  root,
  argv,
  options = {},
  runtime = null,
  userConfig
}) => {
  const modeList = resolveModeList(modeArg);
  const defaultIndexRoot = runtime?.buildRoot
    ? path.resolve(runtime.buildRoot)
    : resolveIndexRoot(root, userConfig);
  const asOfRequested = (
    (typeof argv?.['as-of'] === 'string' && argv['as-of'].trim())
    || (typeof argv?.snapshot === 'string' && argv.snapshot.trim())
  );

  if (!asOfRequested) {
    const cacheKey = createModePlanCacheKey({
      root,
      modeArg,
      argv,
      options,
      runtime,
      defaultIndexRoot
    });
    const cached = readModePlanCache(cacheKey);
    if (cached) return cached;
  }

  const asOfContext = asOfRequested
    ? resolveAsOfContext({
      repoRoot: root,
      userConfig,
      requestedModes: modeList,
      asOf: argv['as-of'],
      snapshot: argv.snapshot,
      preferFrozen: true,
      allowMissingModesForLatest: false
    })
    : null;
  const asOfRootSelection = asOfContext?.provided
    ? resolveSingleRootForModes(asOfContext.indexBaseRootByMode, modeList)
    : { roots: [], root: null, mixed: false };
  if (asOfContext?.strict && modeList.length > 1 && asOfRootSelection.mixed) {
    return {
      errorMessage:
        `[sqlite] --as-of ${asOfContext.ref} resolves to multiple index roots for selected modes. ` +
        'Select a single mode or pass explicit --*-dir overrides.'
    };
  }
  const asOfIndexRoot = asOfContext?.provided && asOfRootSelection.root
    ? path.resolve(asOfRootSelection.root)
    : null;
  const indexRoot = argv['index-root']
    ? path.resolve(argv['index-root'])
    : (options.indexRoot
      ? path.resolve(options.indexRoot)
      : (asOfIndexRoot || defaultIndexRoot));
  const explicitDirs = {
    code: argv['code-dir']
      ? path.resolve(argv['code-dir'])
      : (options.codeDir
        ? path.resolve(options.codeDir)
        : (asOfContext?.provided ? asOfContext.indexDirByMode?.code || null : null)),
    prose: argv['prose-dir']
      ? path.resolve(argv['prose-dir'])
      : (options.proseDir
        ? path.resolve(options.proseDir)
        : (asOfContext?.provided ? asOfContext.indexDirByMode?.prose || null : null)),
    'extracted-prose': argv['extracted-prose-dir']
      ? path.resolve(argv['extracted-prose-dir'])
      : (options.extractedProseDir
        ? path.resolve(options.extractedProseDir)
        : (asOfContext?.provided ? asOfContext.indexDirByMode?.['extracted-prose'] || null : null)),
    records: argv['records-dir']
      ? path.resolve(argv['records-dir'])
      : (options.recordsDir
        ? path.resolve(options.recordsDir)
        : (asOfContext?.provided ? asOfContext.indexDirByMode?.records || null : null))
  };
  if (asOfContext?.strict) {
    for (const mode of modeList) {
      if (!explicitDirs[mode]) {
        return { errorMessage: `[sqlite] ${mode} index is unavailable for --as-of ${asOfContext.ref}.` };
      }
    }
  }
  const modeIndexDirs = {};
  for (const mode of modeList) {
    modeIndexDirs[mode] = explicitDirs[mode] || getIndexDir(root, mode, userConfig, { indexRoot });
  }
  const plan = {
    modeList,
    asOfContext,
    indexRoot,
    explicitDirs,
    indexDir: modeArg === 'all' ? null : modeIndexDirs[modeArg],
    modeIndexDirs
  };
  if (!asOfRequested) {
    const cacheKey = createModePlanCacheKey({
      root,
      modeArg,
      argv,
      options,
      runtime,
      defaultIndexRoot
    });
    writeModePlanCache(cacheKey, {
      ...plan,
      asOfContext: null
    });
  }
  return plan;
};
