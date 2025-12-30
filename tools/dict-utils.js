import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

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
  try {
    const configPath = path.join(repoRoot, '.pairofcleats.json');
    if (!fs.existsSync(configPath)) return {};
    return JSON.parse(fs.readFileSync(configPath, 'utf8')) || {};
  } catch {
    return {};
  }
}

/**
 * Resolve the cache root directory.
 * @returns {string}
 */
export function getCacheRoot() {
  if (process.env.PAIROFCLEATS_HOME) return process.env.PAIROFCLEATS_HOME;
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
  return {
    dir: dict.dir || process.env.PAIROFCLEATS_DICT_DIR || path.join(getCacheRoot(), 'dictionaries'),
    languages: Array.isArray(dict.languages) ? dict.languages : ['en'],
    files: Array.isArray(dict.files) ? dict.files : [],
    includeSlang: dict.includeSlang !== false,
    slangDirs: Array.isArray(dict.slangDirs) ? dict.slangDirs : [],
    slangFiles: Array.isArray(dict.slangFiles) ? dict.slangFiles : [],
    enableRepoDictionary: dict.enableRepoDictionary === true
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
  const cacheRoot = (cfg.cache && cfg.cache.root) || process.env.PAIROFCLEATS_CACHE_ROOT || getCacheRoot();
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
  const id = process.env.PAIROFCLEATS_MODEL || models.id || DEFAULT_MODEL_ID;
  return {
    id,
    dir: getModelsDir(repoRoot, cfg)
  };
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
  const cacheRoot = (cfg.cache && cfg.cache.root) || process.env.PAIROFCLEATS_CACHE_ROOT || getCacheRoot();
  const models = cfg.models || {};
  return models.dir || process.env.PAIROFCLEATS_MODELS_DIR || path.join(cacheRoot, 'models');
}

/**
 * Resolve the tooling cache directory.
 * @param {string} repoRoot
 * @param {object|null} userConfig
 * @returns {string}
 */
export function getToolingDir(repoRoot, userConfig = null) {
  const cfg = userConfig || loadUserConfig(repoRoot);
  const cacheRoot = (cfg.cache && cfg.cache.root) || process.env.PAIROFCLEATS_CACHE_ROOT || getCacheRoot();
  const tooling = cfg.tooling || {};
  return tooling.dir || process.env.PAIROFCLEATS_TOOLING_DIR || path.join(cacheRoot, 'tooling');
}

/**
 * Resolve tooling configuration for a repo.
 * @param {string} repoRoot
 * @param {object|null} userConfig
 * @returns {{autoInstallOnDetect:boolean,installScope:string,allowGlobalFallback:boolean,dir:string}}
 */
export function getToolingConfig(repoRoot, userConfig = null) {
  const cfg = userConfig || loadUserConfig(repoRoot);
  const tooling = cfg.tooling || {};
  const installScope = (tooling.installScope || process.env.PAIROFCLEATS_TOOLING_INSTALL_SCOPE || 'cache').toLowerCase();
  return {
    autoInstallOnDetect: tooling.autoInstallOnDetect === true,
    installScope,
    allowGlobalFallback: tooling.allowGlobalFallback !== false,
    dir: getToolingDir(repoRoot, cfg)
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
  const cacheRoot = (cfg.cache && cfg.cache.root) || process.env.PAIROFCLEATS_CACHE_ROOT || getCacheRoot();
  const extensions = cfg.extensions || {};
  const sqliteVector = cfg.sqlite?.vectorExtension || {};
  return extensions.dir
    || sqliteVector.dir
    || process.env.PAIROFCLEATS_EXTENSIONS_DIR
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
