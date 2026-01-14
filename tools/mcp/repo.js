import fs from 'node:fs';
import path from 'node:path';
import simpleGit from 'simple-git';
import { getEnvConfig } from '../../src/shared/env.js';
import { createSqliteDbCache } from '../../src/retrieval/sqlite-cache.js';
import {
  getCacheRoot,
  getDictConfig,
  getDictionaryPaths,
  getIndexDir,
  getMetricsDir,
  getModelConfig,
  getRepoCacheRoot,
  getRepoId,
  loadUserConfig,
  resolveRepoRoot,
  resolveSqlitePaths
} from '../dict-utils.js';
import { getVectorExtensionConfig, resolveVectorExtensionPath } from '../vector-extension.js';

const repoCaches = new Map();

export const getRepoCaches = (repoPath) => {
  const key = repoPath || process.cwd();
  const existing = repoCaches.get(key);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing;
  }
  const entry = {
    indexCache: new Map(),
    sqliteCache: createSqliteDbCache(),
    lastUsed: Date.now()
  };
  repoCaches.set(key, entry);
  return entry;
};

export const clearRepoCaches = (repoPath) => {
  if (!repoPath) return;
  const entry = repoCaches.get(repoPath);
  if (!entry) return;
  entry.sqliteCache?.closeAll?.();
  entry.indexCache?.clear?.();
  repoCaches.delete(repoPath);
};

/**
 * Resolve and validate a repo path.
 * @param {string} inputPath
 * @returns {string}
 */
export function resolveRepoPath(inputPath) {
  const base = inputPath ? path.resolve(inputPath) : process.cwd();
  if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) {
    throw new Error(`Repo path not found: ${base}`);
  }
  return inputPath ? base : resolveRepoRoot(base);
}

const resolveConfigRoot = (args) => {
  const candidate = args?.repoPath ? path.resolve(String(args.repoPath)) : null;
  if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
    return resolveRepoRoot(candidate);
  }
  return resolveRepoRoot(process.cwd());
};

const resolveMcpConfig = (args) => {
  const repoRoot = resolveConfigRoot(args);
  const cfg = loadUserConfig(repoRoot);
  return cfg?.mcp && typeof cfg.mcp === 'object' ? cfg.mcp : {};
};

export const parseTimeoutMs = (value) => {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : null;
};

export const resolveToolTimeoutMs = (name, args, { envToolTimeoutMs, defaultToolTimeoutMs, defaultToolTimeouts }) => {
  const mcpConfig = resolveMcpConfig(args);
  const toolTimeouts = mcpConfig.toolTimeouts && typeof mcpConfig.toolTimeouts === 'object'
    ? mcpConfig.toolTimeouts
    : {};
  const override = parseTimeoutMs(toolTimeouts[name]);
  const baseTimeout = parseTimeoutMs(mcpConfig.toolTimeoutMs ?? envToolTimeoutMs)
    ?? defaultToolTimeouts[name]
    ?? defaultToolTimeoutMs;
  const resolved = override ?? baseTimeout;
  return resolved && resolved > 0 ? resolved : null;
};

/**
 * Build the artifact path map for a repo.
 * @param {string} repoPath
 * @param {object} userConfig
 * @returns {object}
 */
function listArtifacts(repoPath, userConfig) {
  const indexCode = getIndexDir(repoPath, 'code', userConfig);
  const indexProse = getIndexDir(repoPath, 'prose', userConfig);
  const indexRecords = getIndexDir(repoPath, 'records', userConfig);
  const metricsDir = getMetricsDir(repoPath, userConfig);
  const sqlitePaths = resolveSqlitePaths(repoPath, userConfig);
  return {
    index: {
      code: {
        dir: indexCode,
        chunkMeta: path.join(indexCode, 'chunk_meta.json'),
        tokenPostings: path.join(indexCode, 'token_postings.json')
      },
      prose: {
        dir: indexProse,
        chunkMeta: path.join(indexProse, 'chunk_meta.json'),
        tokenPostings: path.join(indexProse, 'token_postings.json')
      },
      records: {
        dir: indexRecords,
        chunkMeta: path.join(indexRecords, 'chunk_meta.json'),
        tokenPostings: path.join(indexRecords, 'token_postings.json')
      }
    },
    metrics: {
      dir: metricsDir,
      indexCode: path.join(metricsDir, 'index-code.json'),
      indexProse: path.join(metricsDir, 'index-prose.json'),
      indexRecords: path.join(metricsDir, 'index-records.json'),
      queryCache: path.join(metricsDir, 'queryCache.json')
    },
    sqlite: {
      code: sqlitePaths.codePath,
      prose: sqlitePaths.prosePath,
      legacy: sqlitePaths.legacyPath,
      legacyExists: sqlitePaths.legacyExists
    }
  };
}

/**
 * Stat a path if it exists.
 * @param {string} target
 * @returns {{exists:boolean,mtime:(string|null),bytes:number}}
 */
function statIfExists(target) {
  try {
    const stat = fs.statSync(target);
    return {
      exists: true,
      mtime: stat.mtime ? stat.mtime.toISOString() : null,
      bytes: stat.size
    };
  } catch {
    return { exists: false, mtime: null, bytes: 0 };
  }
}

/**
 * Fetch lightweight git status info for a repo.
 * @param {string} repoPath
 * @returns {Promise<object>}
 */
async function getGitInfo(repoPath) {
  const gitDir = path.join(repoPath, '.git');
  const hasGitDir = fs.existsSync(gitDir);
  if (!hasGitDir) {
    return {
      isRepo: false,
      warning: 'Git repository not detected; using path-based repo identity.'
    };
  }
  try {
    const git = simpleGit(repoPath);
    const status = await git.status();
    const head = await git.revparse(['HEAD']);
    return {
      isRepo: true,
      head: head.trim(),
      branch: status.current || null,
      isDirty: status.files.length > 0
    };
  } catch (error) {
    return {
      isRepo: true,
      warning: `Git detected but status unavailable: ${error.message}`
    };
  }
}

/**
 * Build an index status report for the MCP tool.
 * @param {object} [args]
 * @returns {Promise<object>}
 */
export async function indexStatus(args = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  const userConfig = loadUserConfig(repoPath);
  const envConfig = getEnvConfig();
  const cacheRoot = (userConfig.cache && userConfig.cache.root) || envConfig.cacheRoot || getCacheRoot();
  const repoId = getRepoId(repoPath);
  const repoCacheRoot = getRepoCacheRoot(repoPath, userConfig);
  const dictConfig = getDictConfig(repoPath, userConfig);
  const dictPaths = await getDictionaryPaths(repoPath, dictConfig);
  const modelConfig = getModelConfig(repoPath, userConfig);
  const modelsDir = modelConfig.dir;
  const modelDirName = `models--${modelConfig.id.replace('/', '--')}`;
  const modelPath = path.join(modelsDir, modelDirName);

  const artifacts = listArtifacts(repoPath, userConfig);
  const git = await getGitInfo(repoPath);
  const incrementalRoot = path.join(repoCacheRoot, 'incremental');
  const report = {
    repoPath,
    repoId,
    cacheRoot,
    repoCacheRoot,
    git,
    dictionaries: {
      dir: dictConfig.dir,
      files: dictPaths,
      enabled: dictPaths.length > 0,
      includeSlang: dictConfig.includeSlang
    },
    models: {
      dir: modelsDir,
      model: modelConfig.id,
      available: fs.existsSync(modelPath),
      hint: fs.existsSync(modelPath)
        ? null
        : 'Run the download_models tool or `npm run download-models` to prefetch embeddings.'
    },
    incremental: {
      dir: incrementalRoot,
      exists: fs.existsSync(incrementalRoot)
    },
    index: {
      code: {
        dir: artifacts.index.code.dir,
        chunkMeta: statIfExists(artifacts.index.code.chunkMeta),
        tokenPostings: statIfExists(artifacts.index.code.tokenPostings)
      },
      prose: {
        dir: artifacts.index.prose.dir,
        chunkMeta: statIfExists(artifacts.index.prose.chunkMeta),
        tokenPostings: statIfExists(artifacts.index.prose.tokenPostings)
      },
      records: {
        dir: artifacts.index.records.dir,
        chunkMeta: statIfExists(artifacts.index.records.chunkMeta),
        tokenPostings: statIfExists(artifacts.index.records.tokenPostings)
      }
    },
    sqlite: {
      code: { path: artifacts.sqlite.code, ...statIfExists(artifacts.sqlite.code) },
      prose: { path: artifacts.sqlite.prose, ...statIfExists(artifacts.sqlite.prose) },
      legacy: artifacts.sqlite.legacyExists ? artifacts.sqlite.legacy : null
    },
    metrics: {
      dir: artifacts.metrics.dir,
      indexCode: statIfExists(artifacts.metrics.indexCode),
      indexProse: statIfExists(artifacts.metrics.indexProse),
      indexRecords: statIfExists(artifacts.metrics.indexRecords),
      queryCache: statIfExists(artifacts.metrics.queryCache)
    }
  };

  return report;
}

/**
 * Inspect configuration + cache status with warnings.
 * @param {object} [args]
 * @returns {Promise<object>}
 */
export async function configStatus(args = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  const userConfig = loadUserConfig(repoPath);
  const envConfig = getEnvConfig();
  const cacheRoot = (userConfig.cache && userConfig.cache.root) || envConfig.cacheRoot || getCacheRoot();
  const repoCacheRoot = getRepoCacheRoot(repoPath, userConfig);
  const dictConfig = getDictConfig(repoPath, userConfig);
  const dictionaryPaths = await getDictionaryPaths(repoPath, dictConfig);
  const modelConfig = getModelConfig(repoPath, userConfig);
  const modelsDir = modelConfig.dir;
  const modelDirName = `models--${modelConfig.id.replace('/', '--')}`;
  const modelPath = path.join(modelsDir, modelDirName);
  const sqlitePaths = resolveSqlitePaths(repoPath, userConfig);
  const sqliteConfigured = userConfig.sqlite?.use !== false;
  const vectorConfig = getVectorExtensionConfig(repoPath, userConfig);
  const vectorPath = resolveVectorExtensionPath(vectorConfig);

  const warnings = [];
  if (!dictionaryPaths.length && (dictConfig.languages.length || dictConfig.files.length || dictConfig.includeSlang || dictConfig.enableRepoDictionary)) {
    warnings.push({
      code: 'dictionary_missing',
      message: 'No dictionary files found; identifier splitting will be limited.'
    });
  }
  if (!fs.existsSync(modelPath)) {
    warnings.push({
      code: 'model_missing',
      message: `Embedding model not found (${modelConfig.id}). Run npm run download-models.`
    });
  }
  if (sqliteConfigured) {
    const missing = [];
    if (!fs.existsSync(sqlitePaths.codePath)) missing.push(`code=${sqlitePaths.codePath}`);
    if (!fs.existsSync(sqlitePaths.prosePath)) missing.push(`prose=${sqlitePaths.prosePath}`);
    if (missing.length) {
      warnings.push({
        code: 'sqlite_missing',
        message: `SQLite indexes missing (${missing.join(', ')}). Run npm run build-sqlite-index.`
      });
    }
  }
  if (vectorConfig.enabled) {
    if (!vectorPath || !fs.existsSync(vectorPath)) {
      warnings.push({
        code: 'extension_missing',
        message: 'SQLite vector extension is enabled but not installed.'
      });
    }
  }

  return {
    repoPath,
    repoId: getRepoId(repoPath),
    config: {
      cacheRoot,
      repoCacheRoot,
      dictionary: dictConfig,
      models: modelConfig,
      sqlite: {
        use: sqliteConfigured,
        annMode: vectorConfig.annMode || null,
        codeDbPath: sqlitePaths.codePath,
        proseDbPath: sqlitePaths.prosePath
      },
      search: userConfig.search || {},
      indexing: userConfig.indexing || {},
      tooling: userConfig.tooling || {}
    },
    cache: {
      cacheRootExists: fs.existsSync(cacheRoot),
      repoCacheExists: fs.existsSync(repoCacheRoot),
      dictionaries: dictionaryPaths,
      modelAvailable: fs.existsSync(modelPath),
      sqlite: {
        codeExists: fs.existsSync(sqlitePaths.codePath),
        proseExists: fs.existsSync(sqlitePaths.prosePath)
      },
      vectorExtension: {
        enabled: vectorConfig.enabled,
        path: vectorPath,
        available: !!(vectorPath && fs.existsSync(vectorPath))
      }
    },
    warnings
  };
}
