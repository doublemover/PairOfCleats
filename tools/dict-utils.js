import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

export const DEFAULT_MODEL_ID = 'Xenova/all-MiniLM-L12-v2';

export function loadUserConfig(repoRoot) {
  try {
    const configPath = path.join(repoRoot, '.pairofcleats.json');
    if (!fs.existsSync(configPath)) return {};
    return JSON.parse(fs.readFileSync(configPath, 'utf8')) || {};
  } catch {
    return {};
  }
}

export function getCacheRoot() {
  if (process.env.PAIROFCLEATS_HOME) return process.env.PAIROFCLEATS_HOME;
  if (process.env.LOCALAPPDATA) return path.join(process.env.LOCALAPPDATA, 'PairOfCleats');
  if (process.env.XDG_CACHE_HOME) return path.join(process.env.XDG_CACHE_HOME, 'pairofcleats');
  return path.join(os.homedir(), '.cache', 'pairofcleats');
}

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

export function getRepoId(repoRoot) {
  const resolved = path.resolve(repoRoot);
  return crypto.createHash('sha1').update(resolved).digest('hex');
}

export function getRepoCacheRoot(repoRoot, userConfig = null) {
  const cfg = userConfig || loadUserConfig(repoRoot);
  const cacheRoot = (cfg.cache && cfg.cache.root) || process.env.PAIROFCLEATS_CACHE_ROOT || getCacheRoot();
  const repoId = getRepoId(repoRoot);
  return path.join(cacheRoot, 'repos', repoId);
}

export function getModelConfig(repoRoot, userConfig = null) {
  const cfg = userConfig || loadUserConfig(repoRoot);
  const models = cfg.models || {};
  const id = process.env.PAIROFCLEATS_MODEL || models.id || DEFAULT_MODEL_ID;
  return {
    id,
    dir: getModelsDir(repoRoot, cfg)
  };
}

export function getIndexDir(repoRoot, mode, userConfig = null) {
  return path.join(getRepoCacheRoot(repoRoot, userConfig), `index-${mode}`);
}

export function getMetricsDir(repoRoot, userConfig = null) {
  return path.join(getRepoCacheRoot(repoRoot, userConfig), 'repometrics');
}

export function getRepoDictPath(repoRoot, dictConfig = null) {
  const config = dictConfig || getDictConfig(repoRoot);
  const repoId = getRepoId(repoRoot);
  return path.join(config.dir, 'repos', `${repoId}.txt`);
}

export function resolveSqlitePaths(repoRoot, userConfig = null) {
  const cfg = userConfig || loadUserConfig(repoRoot);
  const sqlite = cfg.sqlite || {};
  const defaultDir = path.join(repoRoot, 'index-sqlite');
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

export function getModelsDir(repoRoot, userConfig = null) {
  const cfg = userConfig || loadUserConfig(repoRoot);
  const cacheRoot = (cfg.cache && cfg.cache.root) || process.env.PAIROFCLEATS_CACHE_ROOT || getCacheRoot();
  const models = cfg.models || {};
  return models.dir || process.env.PAIROFCLEATS_MODELS_DIR || path.join(cacheRoot, 'models');
}

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

function resolvePath(repoRoot, filePath) {
  if (!filePath) return null;
  if (path.isAbsolute(filePath)) return filePath;
  return path.join(repoRoot, filePath);
}

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
