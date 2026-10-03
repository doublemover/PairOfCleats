import fs from 'node:fs';
import path from 'node:path';
import {
  getIndexDir,
  getRuntimeConfig,
  loadUserConfig,
  resolveRepoConfigPath,
  resolveRuntimeEnv
} from '../shared/dict-utils.js';

const INDEX_DIR_NAMES = new Set([
  'index',
  'index-code',
  'index-prose',
  'index-extracted-prose',
  'index-records'
]);

export const SERVICE_BUILD_STATE_FILE = 'build_state.json';

export const resolveServiceBuildStatePath = (buildRoot) => (
  buildRoot ? path.join(buildRoot, SERVICE_BUILD_STATE_FILE) : null
);

export const readServiceBuildStateSnapshot = async (buildRoot) => {
  const statePath = resolveServiceBuildStatePath(buildRoot);
  if (!statePath) return null;
  try {
    const raw = await fs.promises.readFile(statePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object'
      ? { state: parsed, path: statePath }
      : null;
  } catch {
    return null;
  }
};

export const looksLikeEmbeddingIndexDir = (value) => {
  const base = path.basename(String(value || '')).toLowerCase();
  return INDEX_DIR_NAMES.has(base) || base.startsWith('index-');
};

export const isEmbeddingIndexDirUnderBuildRoot = ({ buildRoot, indexDir } = {}) => {
  if (!buildRoot || !indexDir) return null;
  const rel = path.relative(path.resolve(buildRoot), path.resolve(indexDir));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/**
 * Resolve legacy embedding payload roots into build/index directory fields.
 *
 * Older jobs may provide only `indexRoot`; this helper infers whether that path
 * points at a build root or a concrete index subdirectory.
 *
 * @param {object} job
 * @returns {{buildRoot:string|null,indexDir:string|null,legacyIndexRoot:string|null}}
 */
export const resolveLegacyEmbeddingPaths = (job) => {
  const legacyIndexRoot = typeof job?.indexRoot === 'string' ? path.resolve(job.indexRoot) : null;
  if (!legacyIndexRoot) return { buildRoot: null, indexDir: null, legacyIndexRoot: null };
  if (looksLikeEmbeddingIndexDir(legacyIndexRoot)) {
    return {
      buildRoot: path.dirname(legacyIndexRoot),
      indexDir: legacyIndexRoot,
      legacyIndexRoot
    };
  }
  return { buildRoot: legacyIndexRoot, indexDir: null, legacyIndexRoot };
};

/**
 * Normalize embedding queue job payload into canonical processing fields.
 *
 * @param {object} job
 * @returns {{
 *   repoRoot:string|null,
 *   buildRoot:string|null,
 *   indexDir:string|null,
 *   legacyIndexRoot:string|null,
 *   formatVersion:number|null
 * }}
 */
export const normalizeEmbeddingJob = (job) => {
  const repoRoot = job?.repoRoot || job?.repo || null;
  let buildRoot = job?.buildRoot ? path.resolve(job.buildRoot) : null;
  let indexDir = job?.indexDir ? path.resolve(job.indexDir) : null;
  let legacyIndexRoot = null;
  if (!buildRoot || !indexDir) {
    const legacy = resolveLegacyEmbeddingPaths(job);
    legacyIndexRoot = legacy.legacyIndexRoot;
    if (!buildRoot && legacy.buildRoot) buildRoot = legacy.buildRoot;
    if (!indexDir && legacy.indexDir) indexDir = legacy.indexDir;
  }
  if (!buildRoot && indexDir && looksLikeEmbeddingIndexDir(indexDir)) {
    buildRoot = path.dirname(indexDir);
  }
  if (repoRoot && buildRoot && !indexDir && job?.mode) {
    const userConfig = loadUserConfig(repoRoot);
    indexDir = getIndexDir(repoRoot, job.mode, userConfig, { indexRoot: buildRoot });
  }
  const indexDirUnderBuildRoot = isEmbeddingIndexDirUnderBuildRoot({ buildRoot, indexDir });
  return {
    repoRoot,
    buildRoot,
    indexDir,
    indexDirUnderBuildRoot,
    legacyIndexRoot,
    formatVersion: Number.isFinite(Number(job?.embeddingPayloadFormatVersion))
      ? Math.max(1, Math.floor(Number(job.embeddingPayloadFormatVersion)))
      : null
  };
};

export const resolveEmbeddingBackendStageDir = (job, mode = null) => {
  const normalized = normalizeEmbeddingJob(job);
  const modeName = String(mode || job?.mode || '').trim();
  if (!modeName) return null;
  const base = normalized.buildRoot || normalized.indexDir || null;
  if (!base) return null;
  return path.join(base, '.embeddings-backend-staging', `index-${modeName}`);
};

/**
 * Build `tools/build/embeddings.js` argv for one job.
 *
 * @param {{buildPath:string,repoPath:string,mode?:string|null,indexRoot?:string|null}} input
 * @returns {string[]}
 */
export const buildEmbeddingsArgs = ({ buildPath, repoPath, mode, indexRoot }) => {
  const args = [buildPath, '--repo', repoPath];
  if (mode && mode !== 'both') args.push('--mode', mode);
  if (indexRoot) args.push('--index-root', indexRoot);
  return args;
};

const DEFAULT_RUNTIME_CONFIG_REVALIDATE_MS = 1000;
const DEFAULT_RUNTIME_CONFIG_CACHE_MAX_ENTRIES = 128;

export const normalizeRuntimeConfigCacheKey = (repoPath) => {
  const resolved = path.resolve(repoPath || process.cwd());
  return process.platform === 'win32'
    ? resolved.toLowerCase()
    : resolved;
};

const setRuntimeConfigCacheEntry = (runtimeConfigCache, maxEntries, cacheKey, entry) => {
  if (runtimeConfigCache.has(cacheKey)) {
    runtimeConfigCache.delete(cacheKey);
  }
  runtimeConfigCache.set(cacheKey, entry);
  while (runtimeConfigCache.size > maxEntries) {
    const oldestKey = runtimeConfigCache.keys().next().value;
    if (oldestKey == null) break;
    runtimeConfigCache.delete(oldestKey);
  }
};

export const readRepoConfigMtime = (repoPath) => {
  const configPath = resolveRepoConfigPath(repoPath, null);
  try {
    const stat = fs.statSync(configPath);
    return {
      configPath,
      mtimeMs: Number.isFinite(stat?.mtimeMs) ? stat.mtimeMs : null
    };
  } catch {
    return { configPath, mtimeMs: null };
  }
};

export function createServiceRuntimeEnvResolver({
  baseEnv = process.env,
  revalidateMs = DEFAULT_RUNTIME_CONFIG_REVALIDATE_MS,
  maxEntries = DEFAULT_RUNTIME_CONFIG_CACHE_MAX_ENTRIES
} = {}) {
  const runtimeConfigCache = new Map();

  const getCachedRuntimeConfig = (repoPath) => {
    const resolvedRepoPath = path.resolve(repoPath || process.cwd());
    const cacheKey = normalizeRuntimeConfigCacheKey(resolvedRepoPath);
    const cached = runtimeConfigCache.get(cacheKey);
    const now = Date.now();
    if (
      cached?.runtimeConfig
      && Number.isFinite(Number(cached.lastConfigCheckAtMs))
      && (now - Number(cached.lastConfigCheckAtMs)) < revalidateMs
    ) {
      setRuntimeConfigCacheEntry(runtimeConfigCache, maxEntries, cacheKey, {
        ...cached,
        lastConfigCheckAtMs: now
      });
      return cached.runtimeConfig;
    }
    const { configPath, mtimeMs } = readRepoConfigMtime(resolvedRepoPath);
    if (
      cached
      && cached.configPath === configPath
      && cached.mtimeMs === mtimeMs
      && cached.runtimeConfig
    ) {
      setRuntimeConfigCacheEntry(runtimeConfigCache, maxEntries, cacheKey, {
        ...cached,
        lastConfigCheckAtMs: now
      });
      return cached.runtimeConfig;
    }
    const userConfig = loadUserConfig(resolvedRepoPath);
    const runtimeConfig = getRuntimeConfig(resolvedRepoPath, userConfig);
    setRuntimeConfigCacheEntry(runtimeConfigCache, maxEntries, cacheKey, {
      runtimeConfig,
      configPath,
      mtimeMs,
      lastConfigCheckAtMs: now
    });
    return runtimeConfig;
  };

  const resolveRepoRuntimeEnv = (repoPath, extraEnv = {}) => {
    const runtimeConfig = getCachedRuntimeConfig(repoPath);
    const envCandidate = extraEnv && typeof extraEnv === 'object'
      ? { ...baseEnv, ...extraEnv }
      : baseEnv;
    return resolveRuntimeEnv(runtimeConfig, envCandidate);
  };

  return {
    getCachedRuntimeConfig,
    resolveRepoRuntimeEnv
  };
}

export function logThreadpoolInfo(repoRoot, label = 'indexer', baseEnv = process.env) {
  const runtimeConfig = repoRoot ? getRuntimeConfig(repoRoot) : { uvThreadpoolSize: null };
  const effectiveUvRaw = Number(baseEnv.UV_THREADPOOL_SIZE);
  const effectiveUvThreadpoolSize = Number.isFinite(effectiveUvRaw) && effectiveUvRaw > 0
    ? Math.floor(effectiveUvRaw)
    : null;
  if (effectiveUvThreadpoolSize) {
    if (runtimeConfig.uvThreadpoolSize && runtimeConfig.uvThreadpoolSize !== effectiveUvThreadpoolSize) {
      console.error(`[${label}] UV_THREADPOOL_SIZE=${effectiveUvThreadpoolSize} (env overrides runtime.uvThreadpoolSize=${runtimeConfig.uvThreadpoolSize})`);
    } else if (runtimeConfig.uvThreadpoolSize) {
      console.error(`[${label}] UV_THREADPOOL_SIZE=${effectiveUvThreadpoolSize} (runtime.uvThreadpoolSize=${runtimeConfig.uvThreadpoolSize})`);
    } else {
      console.error(`[${label}] UV_THREADPOOL_SIZE=${effectiveUvThreadpoolSize} (env)`);
    }
  } else if (runtimeConfig.uvThreadpoolSize) {
    console.error(`[${label}] UV_THREADPOOL_SIZE=default (runtime.uvThreadpoolSize=${runtimeConfig.uvThreadpoolSize} not applied; start via pairofcleats CLI or set UV_THREADPOOL_SIZE before launch)`);
  }
}
