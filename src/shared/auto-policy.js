import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { getCapabilities } from './capabilities.js';
import { buildIgnoreMatcher } from '../index/build/ignore.js';

const QUALITY_LEVELS = ['fast', 'balanced', 'max'];
const DEFAULT_SCAN_LIMITS = {
  maxFiles: 250000,
  maxBytes: 5 * 1024 * 1024 * 1024
};
const DEFAULT_SCAN_STAT_CONCURRENCY = 32;
const DEFAULT_SCAN_PROGRESS_INTERVAL_MS = 1000;
const IGNORE_DIRS = new Set([
  '.git',
  'node_modules',
  '.pairofcleats',
  '.cache',
  'dist',
  'build',
  'out',
  'coverage'
]);
const CANONICAL_HUGE_REPO_PROFILE_ID = 'huge-repo';
const CANONICAL_HUGE_REPO_OVERRIDES = Object.freeze({
  hugeRepoProfile: { enabled: true, id: CANONICAL_HUGE_REPO_PROFILE_ID },
  pipelineOverlap: {
    enabled: true,
    inferPostings: true
  },
  artifacts: {
    writeHeavyThresholdBytes: 64 * 1024 * 1024,
    writeMassiveThresholdBytes: 384 * 1024 * 1024,
    writeUltraLightThresholdBytes: 256 * 1024,
    fieldPostingsShardsEnabled: true,
    chunkMetaBinaryColumnar: true
  },
  scheduler: {
    adaptive: true,
    adaptiveTargetUtilization: 0.82,
    adaptiveStep: 2,
    queues: {
      'stage1.postings': { weight: 5, priority: 20 },
      'stage2.write': { weight: 5, priority: 20 },
      'stage2.relations': { weight: 3, priority: 30 },
      'stage4.sqlite': { weight: 5, priority: 20 },
      'embeddings.compute': { weight: 2, priority: 35 },
      'embeddings.io': { weight: 2, priority: 30 }
    }
  },
  typeInferenceCrossFile: false,
  riskAnalysisCrossFile: false,
  riskInterprocedural: {
    enabled: false
  },
  lexicon: {
    relations: {
      enabled: false
    }
  },
  documentExtraction: {
    enabled: false
  },
  commentExtraction: {
    enabled: false
  },
  records: {
    enabled: false
  }
});

const clonePlain = (value) => JSON.parse(JSON.stringify(value));

const clampQuality = (value) => {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'auto') return 'auto';
  return QUALITY_LEVELS.includes(normalized) ? normalized : null;
};

const downgradeQuality = (quality) => {
  if (quality === 'max') return 'balanced';
  if (quality === 'balanced') return 'fast';
  return quality;
};

const resolveQuality = ({ requested, resources, repo }) => {
  if (requested && requested !== 'auto') {
    return { value: requested, source: 'config' };
  }
  const cpu = resources.cpuCount;
  const memGb = resources.memoryGb;
  let value = 'max';
  if (memGb < 16 || cpu <= 4) value = 'fast';
  else if (memGb < 32 || cpu < 12) value = 'balanced';
  if (repo.huge) value = downgradeQuality(value);
  return { value, source: 'auto' };
};

const summarizeResources = () => {
  const cpuCount = os.cpus().length;
  const memoryGb = Math.round((os.totalmem() / (1024 ** 3)) * 10) / 10;
  return { cpuCount, memoryGb };
};

const formatBytes = (bytes) => {
  const total = Number(bytes);
  if (!Number.isFinite(total) || total <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = total;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
};

const normalizePositiveInt = (value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.min(max, Math.max(min, Math.floor(numeric)));
};

const scanRepoStats = async (repoRoot, limits = {}, options = {}) => {
  const maxFiles = Number.isFinite(limits.maxFiles) ? limits.maxFiles : DEFAULT_SCAN_LIMITS.maxFiles;
  const maxBytes = Number.isFinite(limits.maxBytes) ? limits.maxBytes : DEFAULT_SCAN_LIMITS.maxBytes;
  const statConcurrency = normalizePositiveInt(
    limits.statConcurrency,
    DEFAULT_SCAN_STAT_CONCURRENCY,
    1,
    128
  );
  const dirConcurrency = normalizePositiveInt(
    limits.dirConcurrency,
    Math.max(2, Math.min(16, Math.ceil(statConcurrency / 4))),
    1,
    64
  );
  const progressIntervalMs = normalizePositiveInt(
    options.progressIntervalMs,
    DEFAULT_SCAN_PROGRESS_INTERVAL_MS,
    100,
    60_000
  );
  const logger = typeof options.logger === 'function' ? options.logger : null;
  const ignoreMatcher = options.ignoreMatcher && typeof options.ignoreMatcher.ignores === 'function'
    ? options.ignoreMatcher
    : null;
  let fileCount = 0;
  let totalBytes = 0;
  let truncated = false;
  let dirsScanned = 0;
  const startedAt = Date.now();
  let lastProgressAt = startedAt;

  const logScan = (message) => {
    if (!logger) return;
    logger(`[init] auto policy scan: ${message}`);
  };
  const logProgress = (force = false) => {
    if (!logger) return;
    const now = Date.now();
    if (!force && now - lastProgressAt < progressIntervalMs) return;
    lastProgressAt = now;
    logScan(
      `${fileCount.toLocaleString()} files, ${formatBytes(totalBytes)} ` +
      `across ${dirsScanned.toLocaleString()} directories`
    );
  };

  logScan(
    `starting (maxFiles=${maxFiles.toLocaleString()}, maxBytes=${formatBytes(maxBytes)}, ` +
    `statConcurrency=${statConcurrency}, dirConcurrency=${dirConcurrency})`
  );
  const toRelPosix = (targetPath) => (
    path.relative(repoRoot, targetPath).replaceAll(path.sep, '/')
  );
  const shouldIgnore = (targetPath, isDir) => {
    if (!ignoreMatcher) return false;
    const relPosix = toRelPosix(targetPath);
    if (!relPosix || relPosix === '.' || relPosix.startsWith('..')) return false;
    const lookup = isDir ? `${relPosix}/` : relPosix;
    return ignoreMatcher.ignores(lookup);
  };
  const stack = [repoRoot];
  while (stack.length && !truncated) {
    const batch = stack.splice(-Math.min(dirConcurrency, stack.length));
    const discoveredDirs = [];
    await Promise.all(batch.map(async (current) => {
      if (truncated) return;
      let entries;
      try {
        entries = await fs.readdir(current, { withFileTypes: true });
      } catch {
        return;
      }
      dirsScanned += 1;
      const filesToStat = [];
      for (const entry of entries) {
        if (truncated) break;
        const entryPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          if ((!ignoreMatcher && IGNORE_DIRS.has(entry.name)) || shouldIgnore(entryPath, true)) continue;
          discoveredDirs.push(entryPath);
          continue;
        }
        if (!entry.isFile()) continue;
        if (shouldIgnore(entryPath, false)) continue;
        filesToStat.push(entryPath);
      }
      if (!filesToStat.length || truncated) return;
      fileCount += filesToStat.length;
      if (fileCount > maxFiles) {
        truncated = true;
        return;
      }
      let nextIndex = 0;
      const workerCount = Math.max(1, Math.min(statConcurrency, filesToStat.length));
      const runStatWorker = async () => {
        while (!truncated) {
          const index = nextIndex;
          nextIndex += 1;
          if (index >= filesToStat.length) return;
          try {
            const stats = await fs.stat(filesToStat[index]);
            totalBytes += stats.size || 0;
            if (totalBytes > maxBytes) {
              truncated = true;
              return;
            }
          } catch {}
        }
      };
      await Promise.all(Array.from({ length: workerCount }, () => runStatWorker()));
    }));
    if (discoveredDirs.length) stack.push(...discoveredDirs);
    logProgress();
  }

  const huge = fileCount >= 200000 || totalBytes >= 5 * 1024 * 1024 * 1024;
  logProgress(true);
  logScan(
    `done in ${Math.max(0, Date.now() - startedAt)}ms ` +
    `(files=${fileCount.toLocaleString()}, bytes=${formatBytes(totalBytes)}, ` +
    `truncated=${truncated ? 'yes' : 'no'}, huge=${huge ? 'yes' : 'no'})`
  );
  return {
    fileCount,
    totalBytes,
    truncated,
    huge
  };
};

const resolveConcurrency = (quality, resources, repo = null) => {
  const cpu = resources.cpuCount;
  const memoryGb = Number(resources.memoryGb) || 0;
  const hugeRepo = repo?.huge === true;
  const strongHost = cpu >= 12 && memoryGb >= 32;
  const base = quality === 'fast' ? 4 : quality === 'balanced' ? 8 : 16;
  const hugeRepoFloor = hugeRepo && strongHost
    ? Math.max(12, Math.floor(cpu * 0.9))
    : 0;
  const files = Math.max(1, Math.min(cpu, Math.max(base, hugeRepoFloor)));
  const imports = files;
  const cpuConcurrency = files;
  const io = hugeRepo && strongHost
    ? Math.max(1, Math.min(128, files * 6))
    : Math.max(1, Math.min(64, files * 4));
  return { files, imports, cpu: cpuConcurrency, io };
};

const resolveWorkerPool = (quality, resources, repo = null) => {
  const cpu = resources.cpuCount;
  const memoryGb = Number(resources.memoryGb) || 0;
  const hugeRepo = repo?.huge === true;
  const strongHost = cpu >= 12 && memoryGb >= 32;
  const baseCap = quality === 'fast' ? 4 : quality === 'balanced' ? 8 : 16;
  const cap = hugeRepo && strongHost
    ? Math.max(baseCap, Math.min(32, cpu * 2))
    : baseCap;
  return {
    enabled: cpu > 2,
    maxThreads: Math.max(1, Math.min(cpu, cap))
  };
};

const resolveHugeRepoProfile = ({ config = {}, repo = null }) => {
  const raw = config?.hugeRepoProfile;
  const profileConfig = raw && typeof raw === 'object' ? raw : {};
  const enabled = typeof profileConfig.enabled === 'boolean'
    ? profileConfig.enabled
    : repo?.huge === true;
  const id = enabled ? CANONICAL_HUGE_REPO_PROFILE_ID : 'default';
  const reason = enabled
    ? (repo?.huge === true ? 'repo-size-threshold' : 'explicit-config')
    : 'disabled';
  const overrides = enabled
    ? clonePlain(CANONICAL_HUGE_REPO_OVERRIDES)
    : {};
  return {
    id,
    enabled,
    reason,
    overrides
  };
};

/**
 * Build an auto-selected runtime policy from host resources, repository size,
 * and optional user quality overrides.
 *
 * @param {object} [input]
 * @param {string} [input.repoRoot] Repository root used for repo-size scanning.
 * @param {object} [input.config] User auto-policy configuration overrides.
 * @param {object} [input.scanLimits] Scan limits forwarded to repo stats.
 * @param {object} [input.resources] Optional precomputed host resource summary.
 * @param {object} [input.repo] Optional precomputed repo stats summary.
 * @param {(line:string)=>void} [input.logger] Optional logger for scan/status lines.
 * @returns {Promise<object>} Resolved policy envelope for indexing/retrieval/runtime.
 */
export async function buildAutoPolicy({
  repoRoot,
  config = {},
  scanLimits,
  resources: resourcesOverride,
  repo: repoOverride,
  logger = null
} = {}) {
  const resources = resourcesOverride || summarizeResources();
  let ignoreMatcher = null;
  if (!repoOverride && repoRoot) {
    try {
      const ignore = await buildIgnoreMatcher({ root: repoRoot, userConfig: config });
      ignoreMatcher = ignore.ignoreMatcher || null;
      if (typeof logger === 'function' && Array.isArray(ignore.ignoreFiles) && ignore.ignoreFiles.length) {
        logger(`[init] auto policy scan: loaded ignore files (${ignore.ignoreFiles.join(', ')})`);
      }
    } catch (err) {
      if (typeof logger === 'function') {
        logger(`[warn] auto policy scan ignore setup failed: ${err?.message || err}`);
      }
    }
  }
  const repo = repoOverride || (repoRoot ? await scanRepoStats(repoRoot, scanLimits, { logger, ignoreMatcher }) : {
    fileCount: 0,
    totalBytes: 0,
    truncated: false,
    huge: false
  });
  const requestedQuality = clampQuality(config.quality || 'auto') || 'auto';
  const quality = resolveQuality({ requested: requestedQuality, resources, repo });
  const hugeRepoProfile = resolveHugeRepoProfile({ config, repo });
  const capabilities = getCapabilities();
  const concurrency = resolveConcurrency(quality.value, resources, repo);
  const workerPool = resolveWorkerPool(quality.value, resources, repo);
  if (typeof logger === 'function') {
    logger(
      `[init] auto policy resolved: quality=${quality.value} (${quality.source}), ` +
      `repoHuge=${repo.huge === true ? 'yes' : 'no'}, files=${repo.fileCount.toLocaleString()}, ` +
      `bytes=${formatBytes(repo.totalBytes)}`
    );
  }

  return {
    profile: {
      id: hugeRepoProfile.enabled ? hugeRepoProfile.id : 'default',
      enabled: hugeRepoProfile.enabled,
      reason: hugeRepoProfile.reason
    },
    quality,
    resources,
    repo,
    capabilities,
    indexing: {
      concurrency,
      embeddings: { enabled: quality.value !== 'fast' },
      hugeRepoProfile
    },
    retrieval: {
      backend: 'sqlite',
      ann: { enabled: quality.value !== 'fast' && capabilities.externalBackends.lancedb }
    },
    runtime: { workerPool }
  };
}
