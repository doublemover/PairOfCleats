import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import simpleGit from 'simple-git';
import { createError, ERROR_CODES } from '../../src/shared/error-codes.js';
import { getEnvConfig } from '../../src/shared/env.js';
import { getCapabilities } from '../../src/shared/capabilities.js';
import { hasChunkMetaArtifactsSync } from '../../src/shared/index-artifact-helpers.js';
import {
  getCacheRoot,
  getDictConfig,
  getDictionaryPaths,
  getIndexDir,
  getMetricsDir,
  getQueryCacheDir,
  getModelConfig,
  getRepoCacheRoot,
  getRepoId,
  loadUserConfig,
  resolveRepoRoot,
  toRealPathSync,
  resolveSqlitePaths
} from '../shared/dict-utils.js';
import { getVectorExtensionConfig, resolveVectorExtensionPath } from '../sqlite/vector-extension.js';
import { createRepoCacheManager } from '../shared/repo-cache-config.js';

const repoCacheManager = createRepoCacheManager({
  defaultRepo: process.cwd(),
  namespace: 'mcp'
});

export const getRepoCaches = (repoPath) => repoCacheManager.getRepoCaches(repoPath);

export const refreshRepoCaches = async (repoPath) => {
  if (!repoPath) return;
  await repoCacheManager.refreshRepoCaches(repoPath);
};

export const clearRepoCaches = (repoPath) => {
  if (!repoPath) return;
  repoCacheManager.clearRepoCaches(repoPath);
};

const INDEX_MODES = ['code', 'prose', 'extracted-prose', 'records'];
const CHUNK_META_CANDIDATES = [
  'chunk_meta.json',
  'chunk_meta.jsonl',
  'chunk_meta.meta.json',
  'chunk_meta.columnar.json',
  'chunk_meta.binary-columnar.meta.json'
];

/**
 * Resolve a concrete on-disk artifact path, including compressed siblings.
 *
 * @param {string} indexDir
 * @param {string} relPath
 * @returns {string|null}
 */
const resolveExistingArtifactPath = (indexDir, relPath) => {
  const base = path.join(indexDir, relPath);
  if (fs.existsSync(base)) return base;
  if (fs.existsSync(`${base}.gz`)) return `${base}.gz`;
  if (fs.existsSync(`${base}.zst`)) return `${base}.zst`;
  return null;
};

/**
 * Resolve a stable chunk-meta artifact path for MCP metadata/reporting surfaces.
 *
 * The resolver intentionally prefers concrete on-disk artifacts first, then
 * falls back to manifest-backed layouts so callers can display actionable
 * locations regardless of whether the index uses legacy, compressed, sharded,
 * or manifest-only chunk metadata.
 *
 * @param {string|null|undefined} indexDir
 * @returns {string|null}
 */
const resolveChunkMetaPath = (indexDir) => {
  if (!indexDir) return null;
  for (const candidate of CHUNK_META_CANDIDATES) {
    const existing = resolveExistingArtifactPath(indexDir, candidate);
    if (existing) return existing;
  }
  const partsDir = path.join(indexDir, 'chunk_meta.parts');
  if (fs.existsSync(partsDir)) return partsDir;
  const manifestPath = path.join(indexDir, 'pieces', 'manifest.json');
  if (fs.existsSync(manifestPath) && hasChunkMetaArtifactsSync(indexDir)) {
    return manifestPath;
  }
  return path.join(indexDir, 'chunk_meta.json');
};

const hasRepoArtifacts = (repoPath) => {
  try {
    const userConfig = loadUserConfig(repoPath);
    const repoCacheRoot = getRepoCacheRoot(repoPath, userConfig);
    if (!fs.existsSync(repoCacheRoot) || !fs.statSync(repoCacheRoot).isDirectory()) return false;
    const buildsRoot = path.join(repoCacheRoot, 'builds');
    if (fs.existsSync(path.join(buildsRoot, 'current.json'))) return true;
    return INDEX_MODES.some((mode) => fs.existsSync(path.join(repoCacheRoot, `index-${mode}`)));
  } catch {
    return false;
  }
};

/**
 * Resolve and validate a repo path.
 * @param {string} inputPath
 * @returns {string}
 */
export function resolveRepoPath(inputPath) {
  const base = inputPath ? path.resolve(inputPath) : process.cwd();
  if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) {
    throw createError(ERROR_CODES.INVALID_REQUEST, `Repo path not found: ${base}`);
  }
  const resolvedRoot = toRealPathSync(resolveRepoRoot(base));
  if (!inputPath) return resolvedRoot;

  const explicitPath = toRealPathSync(base);
  if (explicitPath === resolvedRoot) return resolvedRoot;
  if (hasRepoArtifacts(resolvedRoot)) return resolvedRoot;
  if (hasRepoArtifacts(explicitPath)) return explicitPath;
  return resolvedRoot;
}

/**
 * Resolve the repo root used for MCP config lookup.
 *
 * @param {{repoPath?:string}|null|undefined} args
 * @returns {string}
 */
const resolveConfigRoot = (args) => {
  const candidate = args?.repoPath ? path.resolve(String(args.repoPath)) : null;
  if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
    return toRealPathSync(resolveRepoRoot(candidate));
  }
  return toRealPathSync(resolveRepoRoot(process.cwd()));
};

/**
 * Load and normalize the `mcp` config block for the resolved repo.
 *
 * @param {{repoPath?:string}|null|undefined} args
 * @returns {object}
 */
const resolveMcpConfig = (args) => {
  const repoRoot = resolveConfigRoot(args);
  const cfg = loadUserConfig(repoRoot);
  return cfg?.mcp && typeof cfg.mcp === 'object' ? cfg.mcp : {};
};

/**
 * Normalize timeout input into a non-negative integer or `null`.
 *
 * @param {any} value
 * @returns {number|null}
 */
export const parseTimeoutMs = (value) => {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : null;
};

/**
 * Resolve effective timeout for a specific MCP tool.
 *
 * Precedence:
 * 1) `mcp.toolTimeouts[name]`
 * 2) `mcp.toolTimeoutMs` / env override
 * 3) per-tool default map
 * 4) global default timeout
 *
 * Non-positive values collapse to `null` (no timeout).
 *
 * @param {string} name
 * @param {{repoPath?:string}|null|undefined} args
 * @param {{envToolTimeoutMs:any,defaultToolTimeoutMs:number,defaultToolTimeouts:Record<string,number>}} input
 * @returns {number|null}
 */
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
  const queryCacheDir = getQueryCacheDir(repoPath, userConfig);
  const sqlitePaths = resolveSqlitePaths(repoPath, userConfig);
  return {
    index: {
      code: {
        dir: indexCode,
        chunkMeta: resolveChunkMetaPath(indexCode),
        tokenPostings: path.join(indexCode, 'token_postings.json')
      },
      prose: {
        dir: indexProse,
        chunkMeta: resolveChunkMetaPath(indexProse),
        tokenPostings: path.join(indexProse, 'token_postings.json')
      },
      records: {
        dir: indexRecords,
        chunkMeta: resolveChunkMetaPath(indexRecords),
        tokenPostings: path.join(indexRecords, 'token_postings.json')
      }
    },
    metrics: {
      dir: metricsDir,
      indexCode: path.join(metricsDir, 'index-code.json'),
      indexProse: path.join(metricsDir, 'index-prose.json'),
      indexRecords: path.join(metricsDir, 'index-records.json'),
      queryCache: path.join(queryCacheDir, 'queryCache.json')
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
        : 'Run the download_models tool or `node tools/download/models.js` to prefetch embeddings.'
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
  const dictionaryPathsConfigured = await getDictionaryPaths(repoPath, dictConfig, { allowFallback: false });
  const modelConfig = getModelConfig(repoPath, userConfig);
  const modelsDir = modelConfig.dir;
  const modelDirName = `models--${modelConfig.id.replace('/', '--')}`;
  const modelPath = path.join(modelsDir, modelDirName);
  const sqlitePaths = resolveSqlitePaths(repoPath, userConfig);
  const sqliteConfigured = userConfig.sqlite?.use !== false;
  const vectorConfig = getVectorExtensionConfig(repoPath, userConfig);
  const vectorPath = resolveVectorExtensionPath(vectorConfig);
  const capabilities = getCapabilities();

  const warnings = [];
  if (!dictionaryPathsConfigured.length && (dictConfig.languages.length || dictConfig.files.length || dictConfig.includeSlang || dictConfig.enableRepoDictionary)) {
    warnings.push({
      code: 'dictionary_missing',
      message: 'No dictionary files found; identifier splitting will be limited.'
    });
  }
  if (!fs.existsSync(modelPath)) {
    warnings.push({
      code: 'model_missing',
      message: `Embedding model not found (${modelConfig.id}). Run node tools/download/models.js.`
    });
  }
  if (sqliteConfigured) {
    const missing = [];
    if (!fs.existsSync(sqlitePaths.codePath)) missing.push(`code=${sqlitePaths.codePath}`);
    if (!fs.existsSync(sqlitePaths.prosePath)) missing.push(`prose=${sqlitePaths.prosePath}`);
    if (missing.length) {
      warnings.push({
        code: 'sqlite_missing',
        message: `SQLite indexes missing (${missing.join(', ')}). Run "pairofcleats index build --stage 4" (or "node build_index.js --stage 4").`
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
  const normalizeSelector = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');
  const watchBackendRequested = normalizeSelector(userConfig?.indexing?.watch?.backend)
    || normalizeSelector(envConfig.watcherBackend)
    || 'auto';
  if (watchBackendRequested === 'parcel' && !capabilities.watcher.parcel) {
    warnings.push({
      code: 'watcher_backend_missing',
      message: 'indexing.watch.backend=parcel requested but @parcel/watcher is not available.'
    });
  }
  const regexEngineRequested = normalizeSelector(userConfig?.search?.regex?.engine)
    || normalizeSelector(envConfig.regexEngine)
    || 'auto';
  if (regexEngineRequested === 're2' && !capabilities.regex.re2) {
    warnings.push({
      code: 'regex_backend_missing',
      message: 'search.regex.engine=re2 requested but re2 is not available.'
    });
  }
  const hashBackendRequested = normalizeSelector(userConfig?.indexing?.hash?.backend)
    || normalizeSelector(envConfig.xxhashBackend)
    || 'auto';
  if (hashBackendRequested === 'native' && !capabilities.hash.nodeRsXxhash) {
    warnings.push({
      code: 'hash_backend_missing',
      message: 'indexing.hash.backend=native requested but @node-rs/xxhash is not available.'
    });
  }
  const compressionRequested = normalizeSelector(userConfig?.indexing?.artifactCompression?.mode)
    || normalizeSelector(envConfig.compression)
    || 'auto';
  if (compressionRequested === 'zstd' && !capabilities.compression.zstd) {
    warnings.push({
      code: 'compression_backend_missing',
      message: 'indexing.artifactCompression.mode=zstd requested but @mongodb-js/zstd is not available.'
    });
  }
  const docExtractRequested = userConfig?.indexing?.documentExtraction?.enabled === true
    || normalizeSelector(envConfig.docExtract) === 'on';
  if (docExtractRequested && (!capabilities.extractors.pdf || !capabilities.extractors.docx)) {
    warnings.push({
      code: 'document_extract_missing',
      message: 'Document extraction enabled but pdfjs-dist or mammoth is not available.'
    });
  }
  const mcpModeRequested = normalizeSelector(userConfig?.mcp?.mode)
    || normalizeSelector(envConfig.mcpMode)
    || 'auto';
  if (mcpModeRequested === 'sdk' && !capabilities.mcp.sdk) {
    warnings.push({
      code: 'mcp_transport_missing',
      message: 'mcp.mode=sdk requested but @modelcontextprotocol/sdk is not available.'
    });
  }

  return {
    repoPath,
    repoId: getRepoId(repoPath),
    capabilities,
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
      tooling: userConfig.tooling || {},
      mcp: userConfig.mcp || {}
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
