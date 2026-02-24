import fs from 'node:fs';
import path from 'node:path';
import { getMetricsDir, loadUserConfig } from '../../shared/dict-utils.js';

const NON_REPO_RESULTS_FOLDERS = new Set(['logs', 'usr']);

export const listDirs = (root) => fs.existsSync(root)
  ? fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory())
  : [];

/**
 * Throughput aggregates are repo/language focused, so auxiliary benchmark
 * folders (for example USR guardrail snapshots) are excluded by default.
 *
 * @param {string} folderName
 * @param {{includeUsrGuardrails:boolean}} options
 * @returns {boolean}
 */
export const includeResultsFolder = (
  folderName,
  { includeUsrGuardrails = false } = {}
) => {
  if (folderName === 'usr' && includeUsrGuardrails) return true;
  return !NON_REPO_RESULTS_FOLDERS.has(folderName);
};

export const listResultFolders = (
  resultsRoot,
  { includeUsrGuardrails = false } = {}
) => listDirs(resultsRoot).filter((dir) => includeResultsFolder(dir.name, { includeUsrGuardrails }));

export const loadJson = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
};

const loadFeatureMetrics = (repoRoot) => {
  if (!repoRoot) return null;
  const userConfig = loadUserConfig(repoRoot);
  const metricsDir = getMetricsDir(repoRoot, userConfig);
  const runPath = path.join(metricsDir, 'feature-metrics-run.json');
  const mergedPath = path.join(metricsDir, 'feature-metrics.json');
  return loadJson(runPath) || loadJson(mergedPath);
};

const toCachePathKey = (value) => {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    return path.resolve(value).replace(/[\\/]+/g, '/');
  } catch {
    return value.replace(/[\\/]+/g, '/');
  }
};

const readFileStamp = (filePath) => {
  try {
    const stat = fs.statSync(filePath);
    return `${Math.floor(stat.mtimeMs)}:${Math.floor(stat.size)}`;
  } catch {
    return 'missing';
  }
};

const buildMetricsSignature = (runPath, mergedPath) => (
  `${readFileStamp(runPath)}|${readFileStamp(mergedPath)}`
);

const featureMetricsCache = new Map();
export const loadFeatureMetricsCached = (repoRoot) => {
  if (!repoRoot) return null;
  const userConfig = loadUserConfig(repoRoot);
  const metricsDir = getMetricsDir(repoRoot, userConfig);
  const runPath = path.join(metricsDir, 'feature-metrics-run.json');
  const mergedPath = path.join(metricsDir, 'feature-metrics.json');
  const cacheKey = toCachePathKey(repoRoot);
  const signature = buildMetricsSignature(runPath, mergedPath);
  const cached = featureMetricsCache.get(cacheKey);
  if (cached && cached.signature === signature) {
    return cached.metrics;
  }
  const metrics = loadFeatureMetrics(repoRoot) || null;
  featureMetricsCache.set(cacheKey, { signature, metrics });
  return metrics;
};

const featureMetricsByCacheRoot = new Map();
export const loadFeatureMetricsForPayload = (payload) => {
  const repoRoot = payload?.repo?.root || payload?.artifacts?.repo?.root || null;
  const repoMetrics = repoRoot ? loadFeatureMetricsCached(repoRoot) : null;
  if (repoMetrics) return repoMetrics;
  const cacheRoot = payload?.artifacts?.repo?.cacheRoot;
  if (!cacheRoot || typeof cacheRoot !== 'string') return null;
  const runPath = path.join(cacheRoot, 'metrics', 'feature-metrics-run.json');
  const mergedPath = path.join(cacheRoot, 'metrics', 'feature-metrics.json');
  const cacheKey = toCachePathKey(cacheRoot);
  const signature = buildMetricsSignature(runPath, mergedPath);
  const cached = featureMetricsByCacheRoot.get(cacheKey);
  if (cached && cached.signature === signature) return cached.metrics;
  const metrics = loadJson(runPath) || loadJson(mergedPath) || null;
  featureMetricsByCacheRoot.set(cacheKey, { signature, metrics });
  return metrics;
};
