import { getCapabilities } from '../capabilities.js';
import {
  clampQuality,
  formatBytes,
  resolveHugeRepoProfile,
  resolveQuality,
  summarizeResources
} from './profile.js';
import { resolveAutoPolicyIgnoreMatcher, scanRepoStats } from './repo-scan.js';

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

export async function buildAutoPolicy({
  repoRoot,
  config = {},
  scanLimits,
  resources: resourcesOverride,
  repo: repoOverride,
  logger = null
} = {}) {
  const resources = resourcesOverride || summarizeResources();
  const ignoreMatcher = !repoOverride && repoRoot
    ? await resolveAutoPolicyIgnoreMatcher(repoRoot, config, logger)
    : null;
  const repo = repoOverride || (repoRoot
    ? await scanRepoStats(repoRoot, scanLimits, { logger, ignoreMatcher })
    : {
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
