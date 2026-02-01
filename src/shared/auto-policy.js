import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { getCapabilities } from './capabilities.js';

const QUALITY_LEVELS = ['fast', 'balanced', 'max'];
const DEFAULT_SCAN_LIMITS = {
  maxFiles: 250000,
  maxBytes: 5 * 1024 * 1024 * 1024
};
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

const scanRepoStats = async (repoRoot, limits = {}) => {
  const maxFiles = Number.isFinite(limits.maxFiles) ? limits.maxFiles : DEFAULT_SCAN_LIMITS.maxFiles;
  const maxBytes = Number.isFinite(limits.maxBytes) ? limits.maxBytes : DEFAULT_SCAN_LIMITS.maxBytes;
  let fileCount = 0;
  let totalBytes = 0;
  let truncated = false;

  const stack = [repoRoot];
  while (stack.length) {
    const current = stack.pop();
    let dir;
    try {
      dir = await fs.opendir(current);
    } catch {
      continue;
    }
    for await (const entry of dir) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        stack.push(entryPath);
        continue;
      }
      if (!entry.isFile()) continue;
      fileCount += 1;
      if (fileCount > maxFiles) {
        truncated = true;
        break;
      }
      try {
        const stats = await fs.stat(entryPath);
        totalBytes += stats.size || 0;
        if (totalBytes > maxBytes) {
          truncated = true;
          break;
        }
      } catch {
        continue;
      }
    }
    if (truncated) break;
  }

  const huge = fileCount >= 200000 || totalBytes >= 5 * 1024 * 1024 * 1024;
  return {
    fileCount,
    totalBytes,
    truncated,
    huge
  };
};

const resolveConcurrency = (quality, resources) => {
  const cpu = resources.cpuCount;
  const base = quality === 'fast' ? 4 : quality === 'balanced' ? 8 : 16;
  const files = Math.max(1, Math.min(cpu, base));
  const imports = files;
  const cpuConcurrency = files;
  const io = Math.max(1, Math.min(64, files * 4));
  return { files, imports, cpu: cpuConcurrency, io };
};

const resolveWorkerPool = (quality, resources) => {
  const cpu = resources.cpuCount;
  const cap = quality === 'fast' ? 4 : quality === 'balanced' ? 8 : 16;
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
  repo: repoOverride
} = {}) {
  const resources = resourcesOverride || summarizeResources();
  const repo = repoOverride || (repoRoot ? await scanRepoStats(repoRoot, scanLimits) : {
    fileCount: 0,
    totalBytes: 0,
    truncated: false,
    huge: false
  });
  const requestedQuality = clampQuality(config.quality || 'auto') || 'auto';
  const quality = resolveQuality({ requested: requestedQuality, resources, repo });
  const capabilities = getCapabilities();
  const concurrency = resolveConcurrency(quality.value, resources);
  const workerPool = resolveWorkerPool(quality.value, resources);

  return {
    quality,
    resources,
    repo,
    capabilities,
    indexing: {
      concurrency,
      embeddings: { enabled: quality.value !== 'fast' }
    },
    retrieval: {
      backend: 'sqlite',
      ann: { enabled: quality.value !== 'fast' && capabilities.externalBackends.lancedb }
    },
    runtime: { workerPool }
  };
}
