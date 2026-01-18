import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CACHE_MB, DEFAULT_CACHE_TTL_MS } from '../src/shared/cache.js';
import { buildAutoPolicy } from '../src/shared/auto-policy.js';
import { getTestEnvConfig } from '../src/shared/env.js';
import { readJsoncFile } from '../src/shared/jsonc.js';
import { isPlainObject, mergeConfig } from '../src/shared/config.js';
import { validateConfig } from '../src/config/validate.js';
import { stableStringify } from '../src/shared/stable-json.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOOL_ROOT = path.resolve(__dirname, '..');
let toolVersionCache = null;
const DEFAULT_DP_MAX_BY_FILE_COUNT = [
  { maxFiles: 5000, dpMaxTokenLength: 32 },
  { maxFiles: 20000, dpMaxTokenLength: 24 },
  { maxFiles: Number.POSITIVE_INFINITY, dpMaxTokenLength: 16 }
];

export const DEFAULT_MODEL_ID = 'Xenova/all-MiniLM-L12-v2';
export const DEFAULT_TRIAGE_PROMOTE_FIELDS = [
  'recordType',
  'source',
  'recordId',
  'service',
  'env',
  'team',
  'owner',
  'vulnId',
  'cve',
  'packageName',
  'packageEcosystem',
  'severity',
  'status',
  'assetId'
];

/**
 * Load repo-local configuration from .pairofcleats.json.
 * @param {string} repoRoot
 * @returns {object}
 */
export function loadUserConfig(repoRoot) {
  const configPath = path.join(repoRoot, '.pairofcleats.json');
  const applyTestOverrides = (baseConfig) => {
    const testEnv = getTestEnvConfig();
    if (!testEnv.testing || !testEnv.config) return baseConfig;
    return mergeConfig(baseConfig, testEnv.config);
  };
  if (!fs.existsSync(configPath)) return applyTestOverrides(normalizeUserConfig({}));
  const base = readJsoncFile(configPath);
  if (!isPlainObject(base)) {
    throw new Error('Config root must be a JSON object.');
  }
  const schemaPath = path.join(TOOL_ROOT, 'docs', 'config-schema.json');
  const schemaRaw = fs.readFileSync(schemaPath, 'utf8');
  const schema = JSON.parse(schemaRaw);
  const result = validateConfig(schema, base);
  if (!result.ok) {
    const details = result.errors.map((err) => `- ${err}`).join('\n');
    throw new Error(`Config errors in ${configPath}:\n${details}`);
  }
  return applyTestOverrides(normalizeUserConfig(base));
}

/**
 * Resolve the installation root for PairOfCleats tooling.
 * @returns {string}
 */
export function resolveToolRoot() {
  return TOOL_ROOT;
}

/**
 * Resolve the current tool version from package.json.
 * @returns {string|null}
 */
export function getToolVersion() {
  if (toolVersionCache !== null) return toolVersionCache;
  try {
    const pkgPath = path.join(TOOL_ROOT, 'package.json');
    const parsed = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    toolVersionCache = typeof parsed?.version === 'string' ? parsed.version : null;
  } catch {
    toolVersionCache = null;
  }
  return toolVersionCache;
}

/**
 * Compute a stable hash of the effective config inputs for a repo.
 * @param {string} repoRoot
 * @param {object|null} userConfig
 * @returns {string}
 */
export function getEffectiveConfigHash(repoRoot, userConfig = null) {
  const cfg = userConfig || loadUserConfig(repoRoot);
  const payload = { config: cfg };
  const json = stableStringify(payload);
  return crypto.createHash('sha1').update(json).digest('hex');
}

export async function getAutoPolicy(repoRoot, userConfig = null, options = {}) {
  const cfg = userConfig || loadUserConfig(repoRoot);
  return buildAutoPolicy({ repoRoot, config: cfg, scanLimits: options.scanLimits });
}


function normalizeUserConfig(baseConfig) {
  if (!isPlainObject(baseConfig)) return {};
  const normalized = {};
  if (isPlainObject(baseConfig.cache)) {
    const root = typeof baseConfig.cache.root === 'string' ? baseConfig.cache.root.trim() : '';
    if (root) normalized.cache = { root };
  }
  if (typeof baseConfig.quality === 'string') {
    const quality = baseConfig.quality.trim();
    if (quality) normalized.quality = quality;
  }
  if (isPlainObject(baseConfig.search)) {
    const search = {};
    const chunkThreshold = Number(baseConfig.search.sqliteAutoChunkThreshold);
    const artifactBytes = Number(baseConfig.search.sqliteAutoArtifactBytes);
    if (Number.isFinite(chunkThreshold)) {
      search.sqliteAutoChunkThreshold = Math.max(0, Math.floor(chunkThreshold));
    }
    if (Number.isFinite(artifactBytes)) {
      search.sqliteAutoArtifactBytes = Math.max(0, Math.floor(artifactBytes));
    }
    if (Object.keys(search).length) normalized.search = search;
  }
  return normalized;
}

/**
 * Resolve the cache root directory.
 * @returns {string}
 */
export function getCacheRoot() {
  const testRoot = resolveTestCacheRoot(process.env);
  if (testRoot) return testRoot;
  if (process.env.LOCALAPPDATA) return path.join(process.env.LOCALAPPDATA, 'PairOfCleats');
  if (process.env.XDG_CACHE_HOME) return path.join(process.env.XDG_CACHE_HOME, 'pairofcleats');
  return path.join(os.homedir(), '.cache', 'pairofcleats');
}

function resolveTestCacheRoot(env) {
  const testing = env?.PAIROFCLEATS_TESTING === '1' || env?.PAIROFCLEATS_TESTING === 'true';
  if (!testing) return '';
  const raw = typeof env.PAIROFCLEATS_CACHE_ROOT === 'string' ? env.PAIROFCLEATS_CACHE_ROOT.trim() : '';
  return raw || '';
}

/**
 * Resolve dictionary configuration for a repo.
 * @param {string} repoRoot
 * @param {object|null} userConfig
 * @returns {object}
 */
export function getDictConfig(repoRoot, userConfig = null) {
  const cfg = userConfig || loadUserConfig(repoRoot);
  const dict = cfg.dictionary || {};
  const dpMaxTokenLengthByFileCount = normalizeDpMaxTokenLengthByFileCount(
    dict.dpMaxTokenLengthByFileCount
  );
  return {
    dir: dict.dir || path.join(getCacheRoot(), 'dictionaries'),
    languages: Array.isArray(dict.languages) ? dict.languages : ['en'],
    files: Array.isArray(dict.files) ? dict.files : [],
    includeSlang: dict.includeSlang !== false,
    slangDirs: Array.isArray(dict.slangDirs) ? dict.slangDirs : [],
    slangFiles: Array.isArray(dict.slangFiles) ? dict.slangFiles : [],
    enableRepoDictionary: dict.enableRepoDictionary === true,
    segmentation: typeof dict.segmentation === 'string' ? dict.segmentation : 'auto',
    dpMaxTokenLength: Number.isFinite(Number(dict.dpMaxTokenLength))
      ? Number(dict.dpMaxTokenLength)
      : 32,
    dpMaxTokenLengthByFileCount
  };
}

function normalizeDpMaxTokenLengthByFileCount(raw) {
  if (!Array.isArray(raw) || !raw.length) {
    return DEFAULT_DP_MAX_BY_FILE_COUNT.map((entry) => ({ ...entry }));
  }
  const normalized = raw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const maxFiles = Number(entry.maxFiles);
      const dpMaxTokenLength = Number(entry.dpMaxTokenLength);
      if (!Number.isFinite(maxFiles) || maxFiles <= 0) return null;
      if (!Number.isFinite(dpMaxTokenLength) || dpMaxTokenLength <= 0) return null;
      return {
        maxFiles,
        dpMaxTokenLength: Math.max(4, Math.floor(dpMaxTokenLength))
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.maxFiles - b.maxFiles);
  return normalized.length ? normalized : DEFAULT_DP_MAX_BY_FILE_COUNT.map((entry) => ({ ...entry }));
}

export function applyAdaptiveDictConfig(dictConfig, fileCount) {
  if (!dictConfig || typeof dictConfig !== 'object') return dictConfig || {};
  const count = Number(fileCount);
  if (!Number.isFinite(count) || count <= 0) return dictConfig;
  const mode = typeof dictConfig.segmentation === 'string'
    ? dictConfig.segmentation.trim().toLowerCase()
    : 'auto';
  if (mode !== 'auto' && mode !== 'dp') return dictConfig;
  const thresholds = Array.isArray(dictConfig.dpMaxTokenLengthByFileCount)
    && dictConfig.dpMaxTokenLengthByFileCount.length
    ? dictConfig.dpMaxTokenLengthByFileCount
    : DEFAULT_DP_MAX_BY_FILE_COUNT;
  const match = thresholds.find((entry) => count <= entry.maxFiles) || thresholds[thresholds.length - 1];
  if (!match || !Number.isFinite(match.dpMaxTokenLength)) return dictConfig;
  if (dictConfig.dpMaxTokenLength === match.dpMaxTokenLength) return dictConfig;
  return {
    ...dictConfig,
    dpMaxTokenLength: match.dpMaxTokenLength
  };
}

/**
 * Generate a stable repo id from an absolute path.
 * @param {string} repoRoot
 * @returns {string}
 */
export function getRepoId(repoRoot) {
  const resolved = path.resolve(repoRoot);
  const base = path.basename(resolved);
  const normalized = String(base || 'repo')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const prefix = (normalized || 'repo').slice(0, 24);
  const hash = crypto.createHash('sha1').update(resolved).digest('hex').slice(0, 12);
  return `${prefix}-${hash}`;
}

const getLegacyRepoId = (repoRoot) => {
  const resolved = path.resolve(repoRoot);
  return crypto.createHash('sha1').update(resolved).digest('hex');
};

/**
 * Resolve the repo root from a starting directory.
 * @param {string} startPath
 * @returns {string}
 */
export function resolveRepoRoot(startPath = process.cwd()) {
  const base = path.resolve(startPath);
  const gitRoot = resolveGitRoot(base);
  if (gitRoot) return gitRoot;
  const configRoot = findConfigRoot(base);
  return configRoot || base;
}

export function getRepoRoot(repoRoot = null, startPath = process.cwd()) {
  if (repoRoot) return path.resolve(repoRoot);
  return resolveRepoRoot(startPath);
}

function resolveGitRoot(startPath) {
  try {
    const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: startPath,
      encoding: 'utf8'
    });
    if (result.status !== 0) return null;
    const root = String(result.stdout || '').trim();
    return root && fs.existsSync(root) ? root : null;
  } catch {
    return null;
  }
}

function findConfigRoot(startPath) {
  let current = path.resolve(startPath);
  while (true) {
    const configPath = path.join(current, '.pairofcleats.json');
    if (fs.existsSync(configPath)) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

/**
 * Resolve the per-repo cache root.
 * @param {string} repoRoot
 * @param {object|null} userConfig
 * @returns {string}
 */
export function getRepoCacheRoot(repoRoot, userConfig = null) {
  const cfg = userConfig || loadUserConfig(repoRoot);
  const cacheRoot = (cfg.cache && cfg.cache.root) || getCacheRoot();
  const repoId = getRepoId(repoRoot);
  const repoCacheRoot = path.join(cacheRoot, 'repos', repoId);
  const legacyRoot = path.join(cacheRoot, 'repos', getLegacyRepoId(repoRoot));
  if (fs.existsSync(legacyRoot) && !fs.existsSync(repoCacheRoot)) return legacyRoot;
  return repoCacheRoot;
}

/**
 * Resolve the builds root directory for a repo.
 * @param {string} repoRoot
 * @param {object|null} userConfig
 * @returns {string}
 */
export function getBuildsRoot(repoRoot, userConfig = null) {
  return path.join(getRepoCacheRoot(repoRoot, userConfig), 'builds');
}

/**
 * Resolve current build metadata for a repo, if present.
 * @param {string} repoRoot
 * @param {object|null} userConfig
 * @returns {{buildId:string,buildRoot:string,path:string,data:object}|null}
 */
export function getCurrentBuildInfo(repoRoot, userConfig = null, options = {}) {
  const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
  const buildsRoot = path.join(repoCacheRoot, 'builds');
  const currentPath = path.join(buildsRoot, 'current.json');
  if (!fs.existsSync(currentPath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(currentPath, 'utf8')) || {};
    const buildId = typeof data.buildId === 'string' ? data.buildId : null;
    const buildRootRaw = typeof data.buildRoot === 'string' ? data.buildRoot : null;
    const resolveRoot = (value) => {
      if (!value) return null;
      return path.isAbsolute(value) ? value : path.join(repoCacheRoot, value);
    };
    const buildRoot = buildRootRaw
      ? resolveRoot(buildRootRaw)
      : (buildId ? path.join(buildsRoot, buildId) : null);
    const buildRoots = {};
    if (data.buildRoots && typeof data.buildRoots === 'object' && !Array.isArray(data.buildRoots)) {
      for (const [mode, value] of Object.entries(data.buildRoots)) {
        if (typeof value !== 'string') continue;
        const resolved = resolveRoot(value);
        if (resolved) buildRoots[mode] = resolved;
      }
    } else if (buildRoot && Array.isArray(data.modes)) {
      for (const mode of data.modes) {
        if (typeof mode !== 'string') continue;
        buildRoots[mode] = buildRoot;
      }
    }
    const preferredMode = typeof options.mode === 'string' ? options.mode : null;
    const preferredRoot = preferredMode ? buildRoots[preferredMode] : null;
    const activeRoot = preferredRoot || buildRoot || Object.values(buildRoots)[0] || null;
    if (!buildId || !activeRoot || !fs.existsSync(activeRoot)) return null;
    return { buildId, buildRoot: buildRoot || activeRoot, activeRoot, path: currentPath, data, buildRoots };
  } catch {
    return null;
  }
}

/**
 * Resolve the active index root for a repo (current build or legacy path).
 * @param {string} repoRoot
 * @param {object|null} userConfig
 * @param {{indexRoot?:string|null}} [options]
 * @returns {string}
 */
export function resolveIndexRoot(repoRoot, userConfig = null, options = {}) {
  if (options?.indexRoot) return path.resolve(options.indexRoot);
  const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
  const buildsRoot = path.join(repoCacheRoot, 'builds');
  const currentPath = path.join(buildsRoot, 'current.json');
  if (fs.existsSync(currentPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(currentPath, 'utf8')) || {};
      const resolveRoot = (value) => {
        if (!value) return null;
        return path.isAbsolute(value) ? value : path.join(repoCacheRoot, value);
      };
      const buildRootRaw = typeof data.buildRoot === 'string' ? data.buildRoot : null;
      const buildId = typeof data.buildId === 'string' ? data.buildId : null;
      const buildRoot = buildRootRaw
        ? resolveRoot(buildRootRaw)
        : (buildId ? path.join(buildsRoot, buildId) : null);
      const buildRoots = {};
      if (data.buildRoots && typeof data.buildRoots === 'object' && !Array.isArray(data.buildRoots)) {
        for (const [mode, value] of Object.entries(data.buildRoots)) {
          if (typeof value !== 'string') continue;
          buildRoots[mode] = resolveRoot(value);
        }
      } else if (buildRoot && Array.isArray(data.modes)) {
        for (const mode of data.modes) {
          if (typeof mode !== 'string') continue;
          buildRoots[mode] = buildRoot;
        }
      }
      const preferredMode = typeof options.mode === 'string' ? options.mode : null;
      const ensureExists = (value) => (value && fs.existsSync(value) ? value : null);
      let resolved = preferredMode ? ensureExists(buildRoots[preferredMode]) : null;
      if (!resolved && !preferredMode) {
        for (const mode of ['code', 'prose', 'extracted-prose', 'records']) {
          resolved = ensureExists(buildRoots[mode]);
          if (resolved) break;
        }
      }
      if (!resolved) resolved = ensureExists(buildRoot);
      if (resolved) return resolved;
    } catch {}
  }
  return getRepoCacheRoot(repoRoot, userConfig);
}

/**
 * Resolve model configuration for a repo.
 * @param {string} repoRoot
 * @param {object|null} userConfig
 * @returns {{id:string,dir:string}}
 */
export function getModelConfig(repoRoot, userConfig = null) {
  const cfg = userConfig || loadUserConfig(repoRoot);
  const models = cfg.models || {};
  const id = models.id || DEFAULT_MODEL_ID;
  return {
    id,
    dir: getModelsDir(repoRoot, cfg)
  };
}

/**
 * Resolve runtime configuration for a repo.
 * @param {string} repoRoot
 * @param {object|null} userConfig
 * @returns {{maxOldSpaceMb:number|null,nodeOptions:string,uvThreadpoolSize:number|null}}
 */
export function getRuntimeConfig(repoRoot, userConfig = null) {
  loadUserConfig(repoRoot);
  return { maxOldSpaceMb: null, nodeOptions: '', uvThreadpoolSize: null };
}

/**
 * Resolve runtime cache limits and TTLs for a repo.
 * @param {string} repoRoot
 * @param {object|null} userConfig
 * @returns {{fileText:{maxMb:number,ttlMs:number},summary:{maxMb:number,ttlMs:number},lint:{maxMb:number,ttlMs:number},complexity:{maxMb:number,ttlMs:number},gitMeta:{maxMb:number,ttlMs:number}}}
 */
export function getCacheRuntimeConfig(repoRoot, userConfig = null) {
  const cfg = userConfig || loadUserConfig(repoRoot);
  const runtimeCache = cfg.cache?.runtime || {};
  const resolveEntry = (key) => {
    const entry = runtimeCache[key] || {};
    const maxMbRaw = entry.maxMb;
    const ttlMsRaw = entry.ttlMs;
    const maxMb = Number.isFinite(Number(maxMbRaw))
      ? Math.max(0, Number(maxMbRaw))
      : (DEFAULT_CACHE_MB[key] || 0);
    const ttlMs = Number.isFinite(Number(ttlMsRaw))
      ? Math.max(0, Number(ttlMsRaw))
      : (DEFAULT_CACHE_TTL_MS[key] || 0);
    return { maxMb, ttlMs };
  };
  return {
    fileText: resolveEntry('fileText'),
    summary: resolveEntry('summary'),
    lint: resolveEntry('lint'),
    complexity: resolveEntry('complexity'),
    gitMeta: resolveEntry('gitMeta')
  };
}

/**
 * Merge runtime Node options with existing NODE_OPTIONS.
 * @param {{maxOldSpaceMb:number|null,nodeOptions:string}} runtimeConfig
 * @param {string} [baseOptions]
 * @returns {string}
 */
export function resolveNodeOptions(runtimeConfig, baseOptions = process.env.NODE_OPTIONS || '') {
  const base = typeof baseOptions === 'string' ? baseOptions.trim() : '';
  const extras = [];
  if (runtimeConfig?.nodeOptions) extras.push(runtimeConfig.nodeOptions.trim());
  if (Number.isFinite(runtimeConfig?.maxOldSpaceMb) && runtimeConfig.maxOldSpaceMb > 0) {
    const combined = [base, ...extras].join(' ');
    if (!combined.includes('--max-old-space-size')) {
      extras.push(`--max-old-space-size=${Math.floor(runtimeConfig.maxOldSpaceMb)}`);
    }
  }
  return [base, ...extras].filter(Boolean).join(' ').trim();
}


/**
 * Resolve the environment for spawning child processes that need runtime tuning.
 * Respects existing env vars (e.g. will not override an already-set UV_THREADPOOL_SIZE).
 * @param {{maxOldSpaceMb:number|null,nodeOptions:string,uvThreadpoolSize:number|null}} runtimeConfig
 * @param {Record<string, string|undefined>} [baseEnv]
 * @returns {Record<string, string|undefined>}
 */
export function resolveRuntimeEnv(runtimeConfig, baseEnv = process.env) {
  const env = { ...baseEnv };
  const resolvedNodeOptions = resolveNodeOptions(runtimeConfig, env.NODE_OPTIONS || '');
  if (resolvedNodeOptions) {
    env.NODE_OPTIONS = resolvedNodeOptions;
  }
  const uvSize = Number(runtimeConfig?.uvThreadpoolSize);
  if (Number.isFinite(uvSize) && uvSize > 0) {
    const existing = env.UV_THREADPOOL_SIZE;
    if (existing == null || existing === '') {
      env.UV_THREADPOOL_SIZE = String(Math.max(1, Math.min(128, Math.floor(uvSize))));
    }
  }
  return env;
}

/**
 * Resolve the index directory for a repo/mode.
 * @param {string} repoRoot
 * @param {'code'|'prose'|'records'} mode
 * @param {object|null} userConfig
 * @returns {string}
 */
export function getIndexDir(repoRoot, mode, userConfig = null, options = {}) {
  const base = resolveIndexRoot(repoRoot, userConfig, { ...options, mode });
  return path.join(base, `index-${mode}`);
}

/**
 * Resolve triage configuration for a repo.
 * @param {string} repoRoot
 * @param {object|null} userConfig
 * @returns {{recordsDir:string,storeRawPayload:boolean,promoteFields:string[],contextPack:{maxHistory:number,maxEvidencePerQuery:number}}}
 */
export function getTriageConfig(repoRoot, userConfig = null) {
  const cfg = userConfig || loadUserConfig(repoRoot);
  const triage = cfg.triage || {};
  const repoCacheRoot = getRepoCacheRoot(repoRoot, cfg);
  const defaultRecordsDir = path.join(repoCacheRoot, 'triage', 'records');
  const recordsDir = (typeof triage.recordsDir === 'string' && triage.recordsDir.trim())
    ? resolvePath(repoRoot, triage.recordsDir)
    : defaultRecordsDir;
  const promoteFields = Array.isArray(triage.promoteFields)
    ? triage.promoteFields
    : DEFAULT_TRIAGE_PROMOTE_FIELDS;
  const contextPack = triage.contextPack || {};
  const maxHistory = Number.isFinite(Number(contextPack.maxHistory)) ? Number(contextPack.maxHistory) : 5;
  const maxEvidencePerQuery = Number.isFinite(Number(contextPack.maxEvidencePerQuery))
    ? Number(contextPack.maxEvidencePerQuery)
    : 5;
  return {
    recordsDir,
    storeRawPayload: triage.storeRawPayload === true,
    promoteFields,
    contextPack: {
      maxHistory,
      maxEvidencePerQuery
    }
  };
}

/**
 * Resolve the triage records directory for a repo.
 * @param {string} repoRoot
 * @param {object|null} userConfig
 * @returns {string}
 */
export function getTriageRecordsDir(repoRoot, userConfig = null) {
  return getTriageConfig(repoRoot, userConfig).recordsDir;
}

/**
 * Resolve the repometrics directory for a repo.
 * @param {string} repoRoot
 * @param {object|null} userConfig
 * @returns {string}
 */
export function getMetricsDir(repoRoot, userConfig = null) {
  return path.join(getRepoCacheRoot(repoRoot, userConfig), 'repometrics');
}

/**
 * Resolve the path for the repo-specific dictionary file.
 * @param {string} repoRoot
 * @param {object|null} dictConfig
 * @returns {string}
 */
export function getRepoDictPath(repoRoot, dictConfig = null) {
  const config = dictConfig || getDictConfig(repoRoot);
  const repoId = getRepoId(repoRoot);
  return path.join(config.dir, 'repos', `${repoId}.txt`);
}

/**
 * Resolve LMDB database paths for the repo.
 * @param {string} repoRoot
 * @param {object|null} userConfig
 * @returns {{codePath:string,prosePath:string,dbDir:string}}
 */
export function resolveLmdbPaths(repoRoot, userConfig = null, options = {}) {
  const cfg = userConfig || loadUserConfig(repoRoot);
  const lmdb = cfg.lmdb || {};
  const indexRoot = resolveIndexRoot(repoRoot, cfg, options);
  const defaultDir = path.join(indexRoot, 'index-lmdb');
  const dbDir = lmdb.dbDir ? resolvePath(repoRoot, lmdb.dbDir) : defaultDir;
  const codePath = lmdb.codeDbPath
    ? resolvePath(repoRoot, lmdb.codeDbPath)
    : path.join(dbDir, 'index-code');
  const prosePath = lmdb.proseDbPath
    ? resolvePath(repoRoot, lmdb.proseDbPath)
    : path.join(dbDir, 'index-prose');
  return { codePath, prosePath, dbDir };
}

/**
 * Resolve SQLite database paths for the repo.
 * @param {string} repoRoot
 * @param {object|null} userConfig
 * @returns {{codePath:string,prosePath:string,extractedProsePath:string,recordsPath:string,dbDir:string,legacyPath:string,legacyExists:boolean}}
 */
export function resolveSqlitePaths(repoRoot, userConfig = null, options = {}) {
  const cfg = userConfig || loadUserConfig(repoRoot);
  const sqlite = cfg.sqlite || {};
  const repoCacheRoot = getRepoCacheRoot(repoRoot, cfg);
  const indexRoot = resolveIndexRoot(repoRoot, cfg, options);
  const defaultDir = path.join(indexRoot, 'index-sqlite');
  const legacyPath = path.join(repoCacheRoot, 'index-sqlite', 'index.db');
  const dbDir = sqlite.dbDir ? resolvePath(repoRoot, sqlite.dbDir) : defaultDir;
  const codePath = sqlite.codeDbPath
    ? resolvePath(repoRoot, sqlite.codeDbPath)
    : path.join(dbDir, 'index-code.db');
  const prosePath = sqlite.proseDbPath
    ? resolvePath(repoRoot, sqlite.proseDbPath)
    : path.join(dbDir, 'index-prose.db');
  const extractedProsePath = sqlite.extractedProseDbPath
    ? resolvePath(repoRoot, sqlite.extractedProseDbPath)
    : path.join(dbDir, 'index-extracted-prose.db');
  const recordsPath = sqlite.recordsDbPath
    ? resolvePath(repoRoot, sqlite.recordsDbPath)
    : path.join(dbDir, 'index-records.db');
  return {
    codePath,
    prosePath,
    extractedProsePath,
    recordsPath,
    dbDir,
    legacyPath,
    legacyExists: fs.existsSync(legacyPath)
  };
}

/**
 * Resolve the models cache directory.
 * @param {string} repoRoot
 * @param {object|null} userConfig
 * @returns {string}
 */
export function getModelsDir(repoRoot, userConfig = null) {
  const cfg = userConfig || loadUserConfig(repoRoot);
  const cacheRoot = (cfg.cache && cfg.cache.root) || getCacheRoot();
  const models = cfg.models || {};
  return models.dir || path.join(cacheRoot, 'models');
}

/**
 * Resolve the tooling cache directory.
 * @param {string} repoRoot
 * @param {object|null} userConfig
 * @returns {string}
 */
export function getToolingDir(repoRoot, userConfig = null) {
  const cfg = userConfig || loadUserConfig(repoRoot);
  const cacheRoot = (cfg.cache && cfg.cache.root) || getCacheRoot();
  const tooling = cfg.tooling || {};
  return tooling.dir || path.join(cacheRoot, 'tooling');
}

/**
 * Resolve tooling configuration for a repo.
 * @param {string} repoRoot
 * @param {object|null} userConfig
 * @returns {{autoInstallOnDetect:boolean,autoEnableOnDetect:boolean,installScope:string,allowGlobalFallback:boolean,dir:string,enabledTools:string[],disabledTools:string[],typescript:{enabled:boolean,resolveOrder:string[],useTsconfig:boolean,tsconfigPath:string},clangd:{requireCompilationDatabase:boolean,compileCommandsDir:string}}}
 */
export function getToolingConfig(repoRoot, userConfig = null) {
  const cfg = userConfig || loadUserConfig(repoRoot);
  const tooling = cfg.tooling || {};
  const typescript = tooling.typescript || {};
  const clangd = tooling.clangd || {};
  const timeoutMs = Number(tooling.timeoutMs);
  const maxRetries = Number(tooling.maxRetries);
  const breakerThreshold = Number(tooling.circuitBreakerThreshold);
  const logDir = typeof tooling.logDir === 'string' ? tooling.logDir : '';
  const installScope = (tooling.installScope || 'cache').toLowerCase();
  const normalizeOrder = (value) => {
    if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean);
    if (typeof value === 'string') {
      return value.split(',').map((entry) => entry.trim()).filter(Boolean);
    }
    return null;
  };
  const normalizeToolList = (value) => {
    if (Array.isArray(value)) {
      return value.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean);
    }
    if (typeof value === 'string') {
      return value.split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean);
    }
    return [];
  };
  const enabledTools = normalizeToolList(tooling.enabledTools);
  const disabledTools = normalizeToolList(tooling.disabledTools);
  const resolveOrder = normalizeOrder(typescript.resolveOrder) || ['repo', 'cache', 'global'];
  return {
    autoInstallOnDetect: tooling.autoInstallOnDetect === true,
    autoEnableOnDetect: tooling.autoEnableOnDetect !== false,
    timeoutMs: Number.isFinite(timeoutMs) ? Math.max(1000, Math.floor(timeoutMs)) : null,
    maxRetries: Number.isFinite(maxRetries) ? Math.max(0, Math.floor(maxRetries)) : null,
    circuitBreakerThreshold: Number.isFinite(breakerThreshold) ? Math.max(1, Math.floor(breakerThreshold)) : null,
    logDir: logDir.trim(),
    installScope,
    allowGlobalFallback: tooling.allowGlobalFallback !== false,
    dir: getToolingDir(repoRoot, cfg),
    enabledTools,
    disabledTools,
    typescript: {
      enabled: typescript.enabled !== false,
      resolveOrder,
      useTsconfig: typescript.useTsconfig !== false,
      tsconfigPath: typeof typescript.tsconfigPath === 'string' ? typescript.tsconfigPath : ''
    },
    clangd: {
      requireCompilationDatabase: clangd.requireCompilationDatabase === true,
      compileCommandsDir: typeof clangd.compileCommandsDir === 'string' ? clangd.compileCommandsDir : ''
    }
  };
}

/**
 * Resolve the extensions cache directory.
 * @param {string} repoRoot
 * @param {object|null} userConfig
 * @returns {string}
 */
export function getExtensionsDir(repoRoot, userConfig = null) {
  const cfg = userConfig || loadUserConfig(repoRoot);
  const cacheRoot = (cfg.cache && cfg.cache.root) || getCacheRoot();
  const extensions = cfg.extensions || {};
  const sqliteVector = cfg.sqlite?.vectorExtension || {};
  return extensions.dir
    || sqliteVector.dir
    || path.join(cacheRoot, 'extensions');
}

/**
 * Resolve a path relative to the repo root.
 * @param {string} repoRoot
 * @param {string|null} filePath
 * @returns {string|null}
 */
function resolvePath(repoRoot, filePath) {
  if (!filePath) return null;
  if (path.isAbsolute(filePath)) return filePath;
  return path.join(repoRoot, filePath);
}

/**
 * List .txt files in a directory.
 * @param {string} dirPath
 * @returns {Promise<string[]>}
 */
async function listTxtFiles(dirPath) {
  try {
    const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.txt'))
      .map((entry) => path.join(dirPath, entry.name));
  } catch {
    return [];
  }
}

/**
 * Resolve all dictionary paths to load for a repo.
 * @param {string} repoRoot
 * @param {object|null} dictConfig
 * @returns {Promise<string[]>}
 */
export async function getDictionaryPaths(repoRoot, dictConfig = null) {
  const config = dictConfig || getDictConfig(repoRoot);
  const dictDir = config.dir;
  const paths = [];

  const combinedPath = path.join(dictDir, 'combined.txt');
  if (fs.existsSync(combinedPath)) {
    paths.push(combinedPath);
  }

  const languages = Array.from(new Set(config.languages || []));
  for (const lang of languages) {
    const langFile = path.join(dictDir, `${lang}.txt`);
    if (fs.existsSync(langFile)) paths.push(langFile);
  }

  const legacyWords = path.join(dictDir, 'words_alpha.txt');
  if (!paths.length && fs.existsSync(legacyWords)) paths.push(legacyWords);

  for (const filePath of config.files) {
    const resolved = resolvePath(repoRoot, filePath);
    if (resolved && fs.existsSync(resolved)) paths.push(resolved);
  }

  if (config.includeSlang) {
    const slangDirs = config.slangDirs.length
      ? config.slangDirs
      : [path.join(dictDir, 'slang')];
    for (const slangDir of slangDirs) {
      const resolved = resolvePath(repoRoot, slangDir);
      if (!resolved) continue;
      const slangFiles = await listTxtFiles(resolved);
      paths.push(...slangFiles);
    }
    for (const slangFile of config.slangFiles) {
      const resolved = resolvePath(repoRoot, slangFile);
      if (resolved && fs.existsSync(resolved)) paths.push(resolved);
    }
  }

  if (config.enableRepoDictionary) {
    const repoDict = getRepoDictPath(repoRoot, config);
    if (fs.existsSync(repoDict)) paths.push(repoDict);
    const legacyRepoDict = path.join(config.dir, 'repos', `${getLegacyRepoId(repoRoot)}.txt`);
    if (fs.existsSync(legacyRepoDict)) paths.push(legacyRepoDict);
  }

  if (!paths.length) {
    const fallback = path.join(repoRoot, 'tools', 'words_alpha.txt');
    if (fs.existsSync(fallback)) paths.push(fallback);
  }

  return Array.from(new Set(paths));
}
