import path from 'node:path';
import { resolveAsOfContext, resolveSingleRootForModes } from '../../../../index/as-of.js';
import { resolveSqliteModePlan } from '../../../../integrations/core/build-index/stages/sqlite-paths.js';
import {
  getIndexDir,
  resolveRepoCacheRootPath
} from '../../../../shared/dict-utils.js';
import { captureSelectedModeRoots } from '../../../../shared/indexing/selected-mode-roots.js';
import { hasModeArtifacts } from '../../../../shared/indexing/build-pointer.js';

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
    modeIndexDirs: { ...cached.modeIndexDirs },
    modeIndexRoots: { ...cached.modeIndexRoots },
    modeSourceRoots: { ...cached.modeSourceRoots },
    modeStateRoots: { ...cached.modeStateRoots },
    executionGroups: cached.executionGroups.map(entry => ({ ...entry }))
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
    modeIndexDirs: { ...plan.modeIndexDirs },
    modeIndexRoots: { ...plan.modeIndexRoots },
    modeSourceRoots: { ...plan.modeSourceRoots },
    modeStateRoots: { ...plan.modeStateRoots },
    executionGroups: plan.executionGroups.map(entry => ({ ...entry }))
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
  defaultIndexRoot,
  publishedModeRoots
}) => [
  root || '',
  modeArg || 'all',
  argv?.['index-root'] || '',
  options?.indexRoot || '',
  runtime?.buildRoot || '',
  defaultIndexRoot || '',
  JSON.stringify(publishedModeRoots),
  argv?.['code-dir'] || '',
  argv?.['prose-dir'] || '',
  argv?.['extracted-prose-dir'] || '',
  argv?.['records-dir'] || '',
  options?.codeDir || '',
  options?.proseDir || '',
  options?.extractedProseDir || '',
  options?.recordsDir || '',
  argv?.out || options?.out || ''
].join('|');

export const resolveModeList = (modeArg) => (
  modeArg === 'all' ? [...SQLITE_MODE_ORDER] : [modeArg]
);

/**
 * Resolve mode ordering and index directory plan for sqlite builds.
 * @param {object} options
 * @returns {object}
 */
export const resolveModeExecutionPlan = ({ modeArg, root, argv = {}, options = {}, runtime = null, userConfig }) => {
  const modeList = resolveModeList(modeArg);
  const same = (left, right) => {
    const a = path.resolve(left), b = path.resolve(right);
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  };
  const optionKeys = { code: 'codeDir', prose: 'proseDir', 'extracted-prose': 'extractedProseDir', records: 'recordsDir' };
  const cliKeys = { code: 'code-dir', prose: 'prose-dir', 'extracted-prose': 'extracted-prose-dir', records: 'records-dir' };
  const sourceOverrides = Object.fromEntries(SQLITE_MODE_ORDER.map(mode => {
    const value = argv[cliKeys[mode]] || options[optionKeys[mode]];
    return [mode, value ? path.resolve(value) : null];
  }));
  const selectedRoot = argv['index-root'] || options.indexRoot || runtime?.buildRoot;
  const asOfRequested = Boolean((typeof argv['as-of'] === 'string' && argv['as-of'].trim())
    || (typeof argv.snapshot === 'string' && argv.snapshot.trim()));
  if (asOfRequested && (selectedRoot || modeList.some(mode => sourceOverrides[mode]))) return { errorMessage:
    '[sqlite] --as-of/--snapshot cannot be combined with explicit --index-root/--*-dir sources; select one source authority.' };
  const asOfContext = asOfRequested ? resolveAsOfContext({ repoRoot: root, userConfig,
    requestedModes: modeList.filter(mode => !sourceOverrides[mode]), asOf: argv['as-of'], snapshot: argv.snapshot,
    preferFrozen: true, allowMissingModesForLatest: false }) : null;
  const publishedModeRoots = {};
  if (!asOfRequested && !selectedRoot) {
    const required = modeList.filter(mode => !sourceOverrides[mode]);
    const captured = required.length ? captureSelectedModeRoots({ root, userConfig }) : null;
    for (const mode of required) {
      const selected = captured.roots[mode];
      if (!selected || !hasModeArtifacts(selected, mode)) return { errorMessage:
        '[sqlite] active build root for ' + mode + ' is unavailable; run stage2 first or pass explicit source/output paths.' };
      publishedModeRoots[mode] = path.resolve(selected);
    }
  }
  const asOfRootSelection = asOfContext?.provided
    ? resolveSingleRootForModes(asOfContext.indexBaseRootByMode, modeList.filter(mode => !sourceOverrides[mode]))
    : { roots: [], root: null, mixed: false };
  // Explicit input directories never depend on a current pointer for that mode.
  // This final anchor composes output defaults only; it grants no state writes.
  const defaultIndexRoot = selectedRoot ? path.resolve(selectedRoot)
    : asOfRootSelection.root || publishedModeRoots[modeList.find(mode => publishedModeRoots[mode])] || null;
  const indexRoot = defaultIndexRoot || resolveRepoCacheRootPath(root, userConfig);
  const cacheKey = createModePlanCacheKey({ root, modeArg, argv, options, runtime,
    defaultIndexRoot: indexRoot, publishedModeRoots });
  if (!asOfRequested) {
    const cached = readModePlanCache(cacheKey);
    if (cached) return cached;
  }
  const explicitDirs = {}, modeIndexDirs = {}, modeIndexRoots = {}, modeSourceRoots = {}, modeStateRoots = {};
  for (const mode of modeList) {
    const ownerRoot = selectedRoot ? path.resolve(selectedRoot)
      : asOfContext?.provided ? asOfContext.indexBaseRootByMode?.[mode] || null : publishedModeRoots[mode] || null;
    const selectedDir = sourceOverrides[mode] || (asOfContext?.provided ? asOfContext.indexDirByMode?.[mode] || null : null);
    if (asOfContext?.strict && !selectedDir) return { errorMessage:
      '[sqlite] ' + mode + ' index is unavailable for --as-of ' + asOfContext.ref + '.' };
    explicitDirs[mode] = selectedDir;
    modeIndexRoots[mode] = ownerRoot || indexRoot;
    modeIndexDirs[mode] = selectedDir || getIndexDir(root, mode, userConfig, { indexRoot: modeIndexRoots[mode] });
    const canonical = path.basename(modeIndexDirs[mode]).toLowerCase() === ('index-' + mode).toLowerCase();
    modeSourceRoots[mode] = canonical ? path.dirname(modeIndexDirs[mode]) : null;
    const sourceOwned = Boolean(ownerRoot && same(modeIndexDirs[mode], getIndexDir(root, mode, userConfig, { indexRoot: ownerRoot })));
    if (sourceOverrides[mode] && !sourceOwned && !argv.out && !options.out) return { errorMessage:
      '[sqlite] detached ' + mode + ' source requires explicit --out; no unrelated generation state can be updated.' };
    modeStateRoots[mode] = sourceOwned && !asOfContext?.provided ? ownerRoot : null;
  }
  const groups = modeList.map(mode => ({ mode, indexRoot: modeSourceRoots[mode], indexDir: modeIndexDirs[mode] }));
  const executionGroups = groups.every(entry => entry.indexRoot)
    ? resolveSqliteModePlan(groups.map(({ mode, indexRoot }) => ({ mode, indexRoot }))) : groups;
  const plan = { modeList, asOfContext, indexRoot, explicitDirs,
    indexDir: modeArg === 'all' ? null : modeIndexDirs[modeArg], modeIndexDirs, modeIndexRoots,
    modeSourceRoots, modeStateRoots, executionGroups };
  if (!asOfRequested) writeModePlanCache(cacheKey, { ...plan, asOfContext: null });
  return plan;
};
