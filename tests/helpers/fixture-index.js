import { readFixtureHealthSnapshot } from './fixture-health-snapshot.js';
import { applyTestEnv, withTemporaryEnv } from './test-env.js';

import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  getIndexDir,
  getMetricsDir,
  getRepoCacheRoot,
  loadUserConfig,
  resolveSqlitePaths,
  toRealPathSync
} from '../../tools/shared/dict-utils.js';
import {
  MAX_JSON_BYTES,
  loadJsonArrayArtifactSync
} from '../../src/shared/artifact-io.js';
import { runSearchCli } from '../../src/retrieval/cli.js';
import { buildSearchCliArgs } from '../../tools/shared/search-cli-harness.js';
import { formatCommandFailure, formatErroredCommandFailure } from './command-failure.js';

import { rmDirRecursive } from './temp.js';
import { isPlainObject, mergeConfig } from '../../src/shared/config.js';
import { runSqliteBuild } from './sqlite-builder.js';
import { withDirectoryLock } from './directory-lock.js';

import {
  normalizeTestCacheScope,
  resolveDefaultTestBuildStage,
  resolveDefaultTestCacheScope,
  resolveTestCachePath
} from './test-cache.js';
import { runNode } from './run-node.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const ensureDir = async (dir) => {
  await fsPromises.mkdir(dir, { recursive: true });
};

const FIXTURE_MODES = new Set(['code', 'prose', 'extracted-prose', 'records']);
const DEFAULT_REQUIRED_MODES = Object.freeze(['code', 'prose', 'extracted-prose']);
const FIXTURE_HEALTH_VERSION = 8;

const resolveCacheName = (baseName, { cacheScope = 'isolated' } = {}) => {
  const MAX_CACHE_NAME_LENGTH = 64;
  const truncateWithHash = (value) => {
    const text = String(value || '').trim();
    if (!text) return 'fixture-cache';
    if (text.length <= MAX_CACHE_NAME_LENGTH) return text;
    const digest = crypto.createHash('sha1').update(text).digest('hex').slice(0, 10);
    const headLength = Math.max(8, MAX_CACHE_NAME_LENGTH - digest.length - 1);
    return `${text.slice(0, headLength)}-${digest}`;
  };
  const suffixRaw = cacheScope === 'shared'
    ? ''
    : (typeof process.env.PAIROFCLEATS_TEST_CACHE_SUFFIX === 'string'
      ? process.env.PAIROFCLEATS_TEST_CACHE_SUFFIX.trim()
      : '');
  if (!suffixRaw) return truncateWithHash(baseName);
  if (baseName.endsWith(`-${suffixRaw}`)) return truncateWithHash(baseName);
  return truncateWithHash(`${baseName}-${suffixRaw}`);
};

/**
 * Normalize and validate required fixture index modes.
 *
 * @param {string[]|null|undefined} requiredModes
 * @returns {string[]}
 */
const normalizeRequiredModes = (requiredModes) => {
  if (!Array.isArray(requiredModes) || requiredModes.length === 0) {
    return [...DEFAULT_REQUIRED_MODES];
  }
  const normalized = [];
  for (const modeRaw of requiredModes) {
    const mode = String(modeRaw || '').trim().toLowerCase();
    if (!FIXTURE_MODES.has(mode)) {
      throw new Error(`Unsupported fixture mode: ${modeRaw}`);
    }
    if (!normalized.includes(mode)) {
      normalized.push(mode);
    }
  }
  return normalized.length > 0 ? normalized : [...DEFAULT_REQUIRED_MODES];
};

const resolveBuildMode = (requiredModes) => {
  const modeSet = new Set(requiredModes);
  if (modeSet.size === 1) return requiredModes[0];
  if (modeSet.size === 2 && modeSet.has('prose') && modeSet.has('extracted-prose')) {
    return 'prose';
  }
  return null;
};

const normalizeRepoSlug = (repoRoot) => String(path.basename(path.resolve(repoRoot)) || 'repo')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 24) || 'repo';

const getLegacyPrefixedRepoId = (repoRoot) => {
  const resolved = path.resolve(repoRoot);
  const prefix = normalizeRepoSlug(resolved);
  const hash = crypto.createHash('sha1').update(resolved).digest('hex').slice(0, 12);
  return `${prefix}-${hash}`;
};

const DEFAULT_TEST_CONFIG = {
  sqlite: {
    use: false
  },
  indexing: {
    typeInference: false,
    typeInferenceCrossFile: false,
    riskAnalysis: false,
    riskAnalysisCrossFile: false,
    embeddings: {
      enabled: false,
      mode: 'off',
      lancedb: { enabled: false },
      hnsw: { enabled: false }
    }
  },
  tooling: {
    lsp: {
      enabled: false
    }
  }
};

const mergeTestConfig = (rawOverride) => {
  if (typeof rawOverride !== 'string' || !rawOverride.trim()) {
    return DEFAULT_TEST_CONFIG;
  }
  try {
    const parsed = JSON.parse(rawOverride);
    if (!isPlainObject(parsed)) return DEFAULT_TEST_CONFIG;
    return mergeConfig(DEFAULT_TEST_CONFIG, parsed);
  } catch {
    return DEFAULT_TEST_CONFIG;
  }
};

const createFixtureEnv = (cacheRoot, overrides = {}, { requireCodeRiskTags = false } = {}) => {
  const { PAIROFCLEATS_TEST_CONFIG: testConfigOverride, ...restOverrides } = overrides;
  let mergedTestConfig = mergeTestConfig(testConfigOverride);
  if (requireCodeRiskTags) {
    mergedTestConfig = mergeConfig(mergedTestConfig, {
      indexing: {
        riskAnalysis: true,
        riskAnalysisCrossFile: true
      }
    });
  }
  return applyTestEnv({
    cacheRoot,
    embeddings: 'stub',
    testConfig: mergedTestConfig,
    extraEnv: {
      PAIROFCLEATS_WORKER_POOL: 'off',
      ...restOverrides
    }
  });
};

const readFixtureHealthStamp = async (stampPath) => {
  try {
    const raw = await fsPromises.readFile(stampPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
};

/**
 * Persist/merge fixture health stamp used to skip unnecessary rebuilds.
 *
 * @param {string} stampPath
 * @param {{requiredModes:string[],compatibilityKeyByMode:Record<string,string|null>,hasRiskTags:boolean,hasRiskWatchByStep?:boolean}} input
 * @returns {Promise<void>}
 */
const writeFixtureHealthStamp = async (
  stampPath,
  {
    requiredModes,
    compatibilityKeyByMode,
    authorityByMode,
    hasRiskTags,
    hasRiskWatchByStep,
    hasSqlDialectMetadata
  }
) => {
  const existing = await readFixtureHealthStamp(stampPath);
  const existingModes = Array.isArray(existing?.modes) ? existing.modes : [];
  const mergedModes = [...new Set([...existingModes, ...requiredModes])];
  const mergedCompatibility = { ...(existing?.compatibilityKeyByMode || {}) };
  const sameCodeAuthority = Boolean(authorityByMode?.code
    && existing?.authorityByMode?.code === authorityByMode.code);
  for (const mode of requiredModes) {
    mergedCompatibility[mode] = compatibilityKeyByMode?.[mode] || null;
  }
  const payload = {
    version: FIXTURE_HEALTH_VERSION,
    checkedAt: new Date().toISOString(),
    modes: mergedModes,
    compatibilityKeyByMode: mergedCompatibility,
    authorityByMode: { ...(existing?.authorityByMode || {}), ...authorityByMode },
    hasRiskTags: Boolean((sameCodeAuthority && existing?.hasRiskTags) || hasRiskTags),
    hasRiskWatchByStep: Boolean((sameCodeAuthority && existing?.hasRiskWatchByStep) || hasRiskWatchByStep),
    hasSqlDialectMetadata: Boolean(hasSqlDialectMetadata)
  };
  await fsPromises.writeFile(stampPath, JSON.stringify(payload), 'utf8');
};

/**
 * Check whether an existing health stamp satisfies current requirements.
 *
 * @param {object|null} stamp
 * @param {{requiredModes:string[],requireRiskTags:boolean,requireRiskWatchByStep?:boolean,compatibilityKeyByMode:Record<string,string|null>}} input
 * @returns {boolean}
 */
const canUseFixtureHealthStamp = (
  stamp,
  {
    requiredModes,
    requireRiskTags,
    requireRiskWatchByStep,
    requireSqlDialectMetadata,
    compatibilityKeyByMode,
    authorityByMode
  }
) => {
  if (!stamp || typeof stamp !== 'object') return false;
  if (Number(stamp.version) !== FIXTURE_HEALTH_VERSION) return false;
  const stampModes = new Set(Array.isArray(stamp.modes) ? stamp.modes : []);
  if (requiredModes.some((mode) => !stampModes.has(mode))) return false;
  if (requireRiskTags && stamp.hasRiskTags !== true) return false;
  if (requireRiskWatchByStep && stamp.hasRiskWatchByStep !== true) return false;
  if (requireSqlDialectMetadata && stamp.hasSqlDialectMetadata !== true) return false;
  const stampedKeys = stamp.compatibilityKeyByMode || {};
  for (const mode of requiredModes) {
    if (!authorityByMode?.[mode] || stamp.authorityByMode?.[mode] !== authorityByMode[mode]) return false;
    if ((stampedKeys[mode] || null) !== (compatibilityKeyByMode?.[mode] || null)) {
      return false;
    }
  }
  return true;
};

const run = (args, label, options) => {
  const result = runNode(args, label, options?.cwd || process.cwd(), options?.env || process.env, {
    stdio: options?.stdio,
    encoding: options?.encoding,
    timeoutMs: options?.timeout,
    allowFailure: true
  });
  if (result.status !== 0) {
    const command = [process.execPath, ...(Array.isArray(args) ? args : [])].join(' ');
    console.error(formatCommandFailure({
      label,
      command,
      cwd: options?.cwd || process.cwd(),
      result
    }));
    process.exit(result.status ?? 1);
  }
};

/**
 * Ensure fixture indexes exist and satisfy compatibility + health constraints.
 *
 * Rebuilds under a cross-process lock when indexes are missing/incompatible.
 *
 * @param {{
 *  fixtureName:string,
 *  cacheName?:string,
 *  envOverrides?:object,
 *  requireRiskTags?:boolean,
 *  cacheScope?:'isolated'|'shared',
 *  requiredModes?:string[]
 * }} [options]
 * @returns {Promise<{root:string,fixtureRoot:string,cacheRoot:string,env:object,userConfig:object,codeDir:string,proseDir:string}>}
 */
export const ensureFixtureIndex = async ({
  fixtureName,
  cacheName = `fixture-${fixtureName}`,
  envOverrides = {},
  requireRiskTags = false,
  cacheScope = resolveDefaultTestCacheScope(),
  requiredModes,
  buildStage = resolveDefaultTestBuildStage()
} = {}) => {
  if (!fixtureName) throw new Error('fixtureName is required');
  const normalizedCacheScope = normalizeTestCacheScope(cacheScope, { defaultScope: 'isolated' });
  const normalizedRequiredModes = normalizeRequiredModes(requiredModes);
  const requireCodeRiskTags = requireRiskTags && normalizedRequiredModes.includes('code');
  const requireCodeRiskWatchByStep = requireCodeRiskTags;
  const fixtureRootRaw = path.join(ROOT, 'tests', 'fixtures', fixtureName);
  const fixtureRoot = toRealPathSync(fixtureRootRaw);
  const cacheRoot = resolveTestCachePath(ROOT, resolveCacheName(cacheName, { cacheScope: normalizedCacheScope }));
  await ensureDir(cacheRoot);
  const env = createFixtureEnv(cacheRoot, envOverrides, { requireCodeRiskTags });
  const userConfig = loadUserConfig(fixtureRoot);
  const repoCacheRoot = getRepoCacheRoot(fixtureRoot, userConfig);
  const healthStampPath = path.join(repoCacheRoot, '.fixture-health.json');
  const resolveModeDirs = () => ({
    code: getIndexDir(fixtureRoot, 'code', userConfig),
    prose: getIndexDir(fixtureRoot, 'prose', userConfig),
    'extracted-prose': getIndexDir(fixtureRoot, 'extracted-prose', userConfig),
    records: getIndexDir(fixtureRoot, 'records', userConfig)
  });
  const evaluateFixtureState = async () => {
    const modeDirs = resolveModeDirs();
    const snapshot = await readFixtureHealthSnapshot({ modeDirs, requiredModes: normalizedRequiredModes });
    const { compatibility, authorityByMode } = snapshot;
    const compatibleIndexes = compatibility.compatible;
    const requireSqlDialectMetadata = normalizedRequiredModes.includes('code');
    if (!compatibleIndexes) {
      return {
        modeDirs,
        needsRiskTags: requireCodeRiskTags,
        missingSqlDialects: requireSqlDialectMetadata,
        missingChunkUids: true,
        compatibleIndexes,
        usedHealthStamp: false
      };
    }
    const healthStamp = await readFixtureHealthStamp(healthStampPath);
    if (canUseFixtureHealthStamp(healthStamp, {
      requiredModes: normalizedRequiredModes,
      requireRiskTags: requireCodeRiskTags,
      requireRiskWatchByStep: requireCodeRiskWatchByStep,
      requireSqlDialectMetadata,
      authorityByMode,
      compatibilityKeyByMode: compatibility.keyByMode
    })) {
      return {
        modeDirs,
        needsRiskTags: false,
        missingRiskWatchByStep: false,
        missingSqlDialects: false,
        missingChunkUids: false,
        compatibleIndexes,
        usedHealthStamp: true
      };
    }
    const needsRiskTags = requireCodeRiskTags && !snapshot.modes.code?.hasRiskTags;
    const missingRiskWatchByStep = requireCodeRiskWatchByStep && !snapshot.modes.code?.hasRiskWatchByStep;
    const missingSqlDialects = requireSqlDialectMetadata && snapshot.modes.code?.missingSqlDialects === true;
    const missingChunkUids = normalizedRequiredModes.some(mode => !snapshot.modes[mode]?.hasChunkUids);
    if (!needsRiskTags && !missingRiskWatchByStep && !missingChunkUids && !missingSqlDialects) {
      await writeFixtureHealthStamp(healthStampPath, {
        requiredModes: normalizedRequiredModes,
        authorityByMode,
        compatibilityKeyByMode: compatibility.keyByMode,
        hasRiskTags: requireCodeRiskTags,
        hasRiskWatchByStep: requireCodeRiskWatchByStep,
        hasSqlDialectMetadata: !missingSqlDialects
      });
    }
    return {
      modeDirs,
      needsRiskTags,
      missingRiskWatchByStep,
      missingSqlDialects,
      missingChunkUids,
      compatibleIndexes,
      usedHealthStamp: false
    };
  };
  const needsBuild = (state) => (
    !state.compatibleIndexes
    || state.needsRiskTags
    || state.missingRiskWatchByStep
    || state.missingChunkUids
    || state.missingSqlDialects
  );

  let state = await evaluateFixtureState();
  if (needsBuild(state)) {
    const lockRoot = path.join(cacheRoot, '.fixture-locks');
    await ensureDir(lockRoot);
    const buildLockDir = path.join(lockRoot, `${getLegacyPrefixedRepoId(fixtureRoot)}.build.lock`);
    await withDirectoryLock(buildLockDir, async () => {
      state = await evaluateFixtureState();
      if (!needsBuild(state)) return;
      const reposRoot = path.dirname(repoCacheRoot);
      const legacyRoots = new Set([
        path.join(reposRoot, getLegacyPrefixedRepoId(fixtureRootRaw)),
        path.join(reposRoot, getLegacyPrefixedRepoId(fixtureRoot))
      ]);
      for (const legacyRoot of legacyRoots) {
        if (legacyRoot !== repoCacheRoot) {
          await rmDirRecursive(legacyRoot, { retries: 8, delayMs: 150 });
        }
      }
      await rmDirRecursive(repoCacheRoot, { retries: 8, delayMs: 150 });
      await ensureDir(repoCacheRoot);
      const buildMode = resolveBuildMode(normalizedRequiredModes);
      const buildArgs = [path.join(ROOT, 'build_index.js'), '--stub-embeddings', '--repo', fixtureRoot];
      if (typeof buildStage === 'string' && buildStage.trim()) {
        buildArgs.push('--stage', buildStage.trim());
      }
      if (buildMode) {
        buildArgs.push('--mode', buildMode);
      }
      run(
        buildArgs,
        `build index (${fixtureName}${buildMode ? `:${buildMode}` : ''})`,
        { cwd: fixtureRoot, env, stdio: 'inherit' }
      );
      state = await evaluateFixtureState();
    });
  }

  return {
    root: ROOT,
    fixtureRoot,
    cacheRoot,
    env,
    userConfig,
    codeDir: state.modeDirs.code,
    proseDir: state.modeDirs.prose
  };
};

export const ensureFixtureSqlite = async ({ fixtureRoot, userConfig, env }) => {
  let sqlitePaths = resolveSqlitePaths(fixtureRoot, userConfig);
  if (!fs.existsSync(sqlitePaths.codePath) || !fs.existsSync(sqlitePaths.prosePath)) {
    await runSqliteBuild(fixtureRoot, { emitOutput: true });
    sqlitePaths = resolveSqlitePaths(fixtureRoot, userConfig);
  }
  if (!fs.existsSync(sqlitePaths.codePath) || !fs.existsSync(sqlitePaths.prosePath)) {
    throw new Error(
      `SQLite fixture paths are unavailable after build. `
      + `codePath=${sqlitePaths.codePath} prosePath=${sqlitePaths.prosePath}`
    );
  }
  return sqlitePaths;
};

export const loadFixtureIndexMeta = (fixtureRoot, userConfig) => {
  const codeDir = getIndexDir(fixtureRoot, 'code', userConfig);
  let chunkMeta = [];
  let fileMeta = [];
  try {
    chunkMeta = loadJsonArrayArtifactSync(codeDir, 'chunk_meta', {
      maxBytes: MAX_JSON_BYTES,
      strict: true
    });
    fileMeta = loadJsonArrayArtifactSync(codeDir, 'file_meta', {
      maxBytes: MAX_JSON_BYTES,
      strict: true
    });
  } catch (err) {
    console.error(`Failed to load fixture index metadata at ${codeDir}: ${err?.message || err}`);
    process.exit(1);
  }
  const fileById = new Map(
    (Array.isArray(fileMeta) ? fileMeta : []).map((entry) => [entry.id, entry.file])
  );
  const resolveChunkFile = (chunk) => chunk?.file || fileById.get(chunk?.fileId) || null;
  let fileRelations = null;
  try {
    const raw = loadJsonArrayArtifactSync(codeDir, 'file_relations', {
      maxBytes: MAX_JSON_BYTES,
      strict: false
    });
    if (Array.isArray(raw)) {
      fileRelations = new Map();
      raw.forEach((entry) => {
        if (entry?.file) fileRelations.set(entry.file, entry.relations || null);
      });
    }
  } catch {}
  if (!Array.isArray(chunkMeta) || chunkMeta.length === 0) {
    console.error(`Missing or empty chunk metadata for fixture index at ${codeDir}`);
    process.exit(1);
  }
  const getFileRelations = (file) => (fileRelations?.get(file) || null);
  return {
    codeDir,
    chunkMeta,
    fileMeta,
    fileById,
    resolveChunkFile,
    fileRelations,
    getFileRelations
  };
};

export const loadFixtureMetricsDir = (fixtureRoot, userConfig) =>
  getMetricsDir(fixtureRoot, userConfig);

export const fixtureIndexInternals = {
  createFixtureEnv,
  withTemporaryEnv
};

/**
 * Create in-process search runner bound to one fixture repository.
 *
 * @param {{root?:string,fixtureRoot:string,env?:object}} [options]
 * @returns {(options?:object)=>Promise<object>}
 */
export const createInProcessSearchRunner = ({
  root = null,
  fixtureRoot,
  env
} = {}) => {
  if (!fixtureRoot) throw new Error('fixtureRoot is required');
  const indexCache = new Map();
  const sqliteCache = new Map();
  return async ({
    query,
    args = [],
    mode = 'code',
    annEnabled = false,
    backend = null,
    explain = false,
    stats = false,
    compact = false,
    topN = null
  } = {}) => {
    const extraArgs = Array.isArray(args) ? args : [];
    const rawArgs = buildSearchCliArgs({
      query,
      json: true,
      annEnabled,
      mode,
      backend,
      explain,
      stats,
      compact,
      topN,
      repo: fixtureRoot,
      extraArgs
    });
    try {
      const runOptions = {
        emitOutput: false,
        exitOnError: false,
        indexCache,
        sqliteCache
      };
      if (typeof root === 'string' && root.trim()) {
        runOptions.root = root;
      }
      return await withTemporaryEnv(env, async () => runSearchCli(rawArgs, runOptions));
    } catch (err) {
      const command = [path.join(root || ROOT, 'search.js'), ...rawArgs].join(' ');
      console.error(formatErroredCommandFailure({
        label: 'search',
        command,
        cwd: fixtureRoot,
        error: err || {}
      }));
      process.exit(1);
    }
  };
};

/**
 * Run search CLI as child process against fixture repo and parse JSON payload.
 *
 * @param {{root?:string,fixtureRoot:string,env?:object,query:string,args?:string[],mode?:string}} input
 * @returns {object}
 */
export const runSearch = ({
  root = ROOT,
  fixtureRoot,
  env,
  query,
  args = [],
  mode = 'code'
}) => {
  const searchArgs = [path.join(root, 'search.js'), query, '--mode', mode, '--json', '--no-ann', '--repo', fixtureRoot, ...args];
  const result = runNode(searchArgs, 'search', fixtureRoot, env, {
    stdio: 'pipe',
    allowFailure: true
  });
  if (result.status !== 0) {
    const command = [process.execPath, ...searchArgs].join(' ');
    console.error(formatCommandFailure({
      label: 'search',
      command,
      cwd: fixtureRoot,
      result
    }));
    process.exit(result.status ?? 1);
  }
  try {
    return JSON.parse(result.stdout || '{}');
  } catch (err) {
    console.error(`Failed to parse search output: ${err?.message || err}`);
    process.exit(1);
  }
};
