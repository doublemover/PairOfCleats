import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CACHE_MB, DEFAULT_CACHE_TTL_MS } from '../src/shared/cache.js';
import { isPlainObject, mergeConfig } from '../src/shared/config.js';
import { getEnvConfig } from '../src/shared/env.js';
import { stableStringify } from '../src/shared/stable-json.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOOL_ROOT = path.resolve(__dirname, '..');
const PROFILES_DIR = path.resolve(TOOL_ROOT, 'profiles');
const profileWarnings = new Set();
const deprecationWarnings = new Set();
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
 * Load repo-local configuration from .pairofcleats.json and apply profiles.
 * @param {string} repoRoot
 * @param {{profile?:string}} [options]
 * @returns {object}
 */
export function loadUserConfig(repoRoot, options = {}) {
  try {
    const configPath = path.join(repoRoot, '.pairofcleats.json');
    if (!fs.existsSync(configPath)) {
      return normalizeUserConfig(applyProfileConfig({}, options.profile), repoRoot);
    }
    const base = JSON.parse(fs.readFileSync(configPath, 'utf8')) || {};
    return normalizeUserConfig(applyProfileConfig(base, options.profile), repoRoot);
  } catch {
    return {};
  }
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
  const env = getEnvConfig();
  const payload = { config: cfg, env };
  const json = stableStringify(payload);
  return crypto.createHash('sha1').update(json).digest('hex');
}


function warnDeprecatedConfig(key, replacement, detail = '') {
  const note = replacement ? `Use ${replacement} instead.` : 'Remove this key.';
  const message = `[config] Deprecated ${key}. ${note}${detail ? ` ${detail}` : ''}`;
  if (deprecationWarnings.has(message)) return;
  deprecationWarnings.add(message);
  console.error(message);
}

function normalizeUserConfig(baseConfig, repoRoot) {
  if (!isPlainObject(baseConfig)) return baseConfig || {};

  const cfg = baseConfig;
  const sqlite = isPlainObject(cfg.sqlite) ? cfg.sqlite : null;
  if (sqlite?.dbPath) {
    warnDeprecatedConfig('sqlite.dbPath', 'sqlite.dbDir or sqlite.codeDbPath/sqlite.proseDbPath', 'Single DB paths are legacy.');
    if (!sqlite.dbDir && !sqlite.codeDbPath && !sqlite.proseDbPath) {
      const resolved = path.isAbsolute(sqlite.dbPath)
        ? sqlite.dbPath
        : path.join(repoRoot, sqlite.dbPath);
      sqlite.dbDir = path.dirname(resolved);
    }
  }
  if (sqlite?.annMode) {
    warnDeprecatedConfig('sqlite.annMode', 'sqlite.vectorExtension.annMode');
    if (!sqlite.vectorExtension || !isPlainObject(sqlite.vectorExtension)) {
      sqlite.vectorExtension = {};
    }
    if (!sqlite.vectorExtension.annMode) {
      sqlite.vectorExtension.annMode = sqlite.annMode;
    }
  }

  const indexing = isPlainObject(cfg.indexing) ? cfg.indexing : null;
  const fileCaps = indexing && isPlainObject(indexing.fileCaps) ? indexing.fileCaps : null;
  if (fileCaps?.defaults && !fileCaps.default) {
    warnDeprecatedConfig('indexing.fileCaps.defaults', 'indexing.fileCaps.default');
    fileCaps.default = fileCaps.defaults;
  }
  if (fileCaps?.byExtension && !fileCaps.byExt) {
    warnDeprecatedConfig('indexing.fileCaps.byExtension', 'indexing.fileCaps.byExt');
    fileCaps.byExt = fileCaps.byExtension;
  }
  if (fileCaps?.byLang && !fileCaps.byLanguage) {
    warnDeprecatedConfig('indexing.fileCaps.byLang', 'indexing.fileCaps.byLanguage');
    fileCaps.byLanguage = fileCaps.byLang;
  }

  const cache = isPlainObject(cfg.cache) ? cfg.cache : null;
  const runtime = cache && isPlainObject(cache.runtime) ? cache.runtime : null;
  if (runtime) {
    for (const entry of Object.values(runtime)) {
      if (!isPlainObject(entry)) continue;
      if (entry.maxMB != null && entry.maxMb == null) {
        warnDeprecatedConfig('cache.runtime.*.maxMB', 'cache.runtime.*.maxMb');
        entry.maxMb = entry.maxMB;
      }
      if (entry.ttlMS != null && entry.ttlMs == null) {
        warnDeprecatedConfig('cache.runtime.*.ttlMS', 'cache.runtime.*.ttlMs');
        entry.ttlMs = entry.ttlMS;
      }
    }
  }

  return cfg;
}


function loadProfileConfig(profileName) {
  if (!profileName) return { config: {}, path: null, error: null };
  const profileFile = `${profileName}.json`;
  const profilePath = path.join(PROFILES_DIR, profileFile);
  if (!fs.existsSync(profilePath)) {
    return {
      config: {},
      path: profilePath,
      error: `Profile not found: ${profilePath}`
    };
  }
  try {
    const config = JSON.parse(fs.readFileSync(profilePath, 'utf8')) || {};
    if (isPlainObject(config)) delete config.profile;
    return { config, path: profilePath, error: null };
  } catch (error) {
    return {
      config: {},
      path: profilePath,
      error: `Failed to parse profile ${profilePath}: ${error?.message || error}`
    };
  }
}

function applyProfileConfig(baseConfig, profileOverride) {
  const overrideName = typeof profileOverride === 'string' ? profileOverride.trim() : '';
  const envProfile = getEnvConfig().profile || '';
  const configProfile = typeof baseConfig?.profile === 'string' ? baseConfig.profile.trim() : '';
  const profileName = overrideName || envProfile || configProfile;
  if (!profileName) return baseConfig || {};
  const { config: profileConfig, path: profilePath, error } = loadProfileConfig(profileName);
  if (error) {
    const key = `${profileName}:${profilePath}`;
    if (!profileWarnings.has(key)) {
      profileWarnings.add(key);
      console.error(`[config] ${error}`);
    }
  }
  const merged = mergeConfig(profileConfig, baseConfig || {});
  merged.profile = profileName;
  return merged;
}

/**
 * Resolve the cache root directory.
 * @returns {string}
 */
export function getCacheRoot() {
  const envConfig = getEnvConfig();
  if (envConfig.home) return envConfig.home;
  if (process.env.LOCALAPPDATA) return path.join(process.env.LOCALAPPDATA, 'PairOfCleats');
  if (process.env.XDG_CACHE_HOME) return path.join(process.env.XDG_CACHE_HOME, 'pairofcleats');
  return path.join(os.homedir(), '.cache', 'pairofcleats');
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
  const envConfig = getEnvConfig();
  const dpMaxTokenLengthByFileCount = normalizeDpMaxTokenLengthByFileCount(
    dict.dpMaxTokenLengthByFileCount
  );
  return {
    dir: dict.dir || envConfig.dictDir || path.join(getCacheRoot(), 'dictionaries'),
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
  return crypto.createHash('sha1').update(resolved).digest('hex');
}

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
  const envConfig = getEnvConfig();
  const cacheRoot = (cfg.cache && cfg.cache.root) || envConfig.cacheRoot || getCacheRoot();
  const repoId = getRepoId(repoRoot);
  return path.join(cacheRoot, 'repos', repoId);
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
  const envConfig = getEnvConfig();
  const id = envConfig.model || models.id || DEFAULT_MODEL_ID;
  return {
    id,
    dir: getModelsDir(repoRoot, cfg)
  };
}

/**
 * Resolve runtime configuration for a repo.
 * @param {string} repoRoot
 * @param {object|null} userConfig
 * @returns {{maxOldSpaceMb:number|null,nodeOptions:string}}
 */
export function getRuntimeConfig(repoRoot, userConfig = null) {
  const cfg = userConfig || loadUserConfig(repoRoot);
  const runtime = cfg.runtime || {};
  const envConfig = getEnvConfig();
  const rawMaxOldSpace = runtime.maxOldSpaceMb ?? envConfig.maxOldSpaceMb;
  const parsedMaxOldSpace = Number(rawMaxOldSpace);
  const maxOldSpaceMb = Number.isFinite(parsedMaxOldSpace) && parsedMaxOldSpace > 0
    ? parsedMaxOldSpace
    : null;
  const nodeOptionsRaw = runtime.nodeOptions ?? envConfig.nodeOptions;
  const nodeOptions = typeof nodeOptionsRaw === 'string' ? nodeOptionsRaw.trim() : '';
  return { maxOldSpaceMb, nodeOptions };
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
    const maxMbRaw = entry.maxMb ?? entry.maxMB;
    const ttlMsRaw = entry.ttlMs ?? entry.ttlMS;
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
 * Resolve the index directory for a repo/mode.
 * @param {string} repoRoot
 * @param {'code'|'prose'|'records'} mode
 * @param {object|null} userConfig
 * @returns {string}
 */
export function getIndexDir(repoRoot, mode, userConfig = null) {
  return path.join(getRepoCacheRoot(repoRoot, userConfig), `index-${mode}`);
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
 * Resolve SQLite database paths for the repo.
 * @param {string} repoRoot
 * @param {object|null} userConfig
 * @returns {{codePath:string,prosePath:string,dbDir:string,legacyPath:string,legacyExists:boolean}}
 */
export function resolveSqlitePaths(repoRoot, userConfig = null) {
  const cfg = userConfig || loadUserConfig(repoRoot);
  const sqlite = cfg.sqlite || {};
  const repoCacheRoot = getRepoCacheRoot(repoRoot, cfg);
  const defaultDir = path.join(repoCacheRoot, 'index-sqlite');
  const legacyPath = sqlite.dbPath ? resolvePath(repoRoot, sqlite.dbPath) : path.join(defaultDir, 'index.db');
  const dbDir = sqlite.dbDir ? resolvePath(repoRoot, sqlite.dbDir) : defaultDir;
  const codePath = sqlite.codeDbPath
    ? resolvePath(repoRoot, sqlite.codeDbPath)
    : path.join(dbDir, 'index-code.db');
  const prosePath = sqlite.proseDbPath
    ? resolvePath(repoRoot, sqlite.proseDbPath)
    : path.join(dbDir, 'index-prose.db');
  return {
    codePath,
    prosePath,
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
  const envConfig = getEnvConfig();
  const cacheRoot = (cfg.cache && cfg.cache.root) || envConfig.cacheRoot || getCacheRoot();
  const models = cfg.models || {};
  return models.dir || envConfig.modelsDir || path.join(cacheRoot, 'models');
}

/**
 * Resolve the tooling cache directory.
 * @param {string} repoRoot
 * @param {object|null} userConfig
 * @returns {string}
 */
export function getToolingDir(repoRoot, userConfig = null) {
  const cfg = userConfig || loadUserConfig(repoRoot);
  const envConfig = getEnvConfig();
  const cacheRoot = (cfg.cache && cfg.cache.root) || envConfig.cacheRoot || getCacheRoot();
  const tooling = cfg.tooling || {};
  return tooling.dir || envConfig.toolingDir || path.join(cacheRoot, 'tooling');
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
  const envConfig = getEnvConfig();
  const installScope = (tooling.installScope || envConfig.toolingInstallScope || 'cache').toLowerCase();
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
  const envConfig = getEnvConfig();
  const cacheRoot = (cfg.cache && cfg.cache.root) || envConfig.cacheRoot || getCacheRoot();
  const extensions = cfg.extensions || {};
  const sqliteVector = cfg.sqlite?.vectorExtension || {};
  return extensions.dir
    || sqliteVector.dir
    || envConfig.extensionsDir
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
  }

  if (!paths.length) {
    const fallback = path.join(repoRoot, 'tools', 'words_alpha.txt');
    if (fs.existsSync(fallback)) paths.push(fallback);
  }

  return Array.from(new Set(paths));
}
