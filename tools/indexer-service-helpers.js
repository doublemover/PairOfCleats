import path from 'node:path';
import { getIndexDir, loadUserConfig } from './dict-utils.js';

export const resolveLegacyEmbeddingPaths = (job) => {
  const legacyIndexRoot = typeof job?.indexRoot === 'string' ? path.resolve(job.indexRoot) : null;
  if (!legacyIndexRoot) return { buildRoot: null, indexDir: null, legacyIndexRoot: null };
  const base = path.basename(legacyIndexRoot).toLowerCase();
  const looksLikeIndexDir = base === 'index'
    || base === 'index-code'
    || base === 'index-prose'
    || base === 'index-extracted-prose'
    || base === 'index-records'
    || base.startsWith('index-');
  if (looksLikeIndexDir) {
    return {
      buildRoot: path.dirname(legacyIndexRoot),
      indexDir: legacyIndexRoot,
      legacyIndexRoot
    };
  }
  return { buildRoot: legacyIndexRoot, indexDir: null, legacyIndexRoot };
};

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
  if (repoRoot && buildRoot && !indexDir && job?.mode) {
    const userConfig = loadUserConfig(repoRoot);
    indexDir = getIndexDir(repoRoot, job.mode, userConfig, { indexRoot: buildRoot });
  }
  return {
    repoRoot,
    buildRoot,
    indexDir,
    legacyIndexRoot,
    formatVersion: Number.isFinite(Number(job?.embeddingPayloadFormatVersion))
      ? Math.max(1, Math.floor(Number(job.embeddingPayloadFormatVersion)))
      : null
  };
};

export const buildEmbeddingsArgs = ({ buildPath, repoPath, mode, indexRoot }) => {
  const args = [buildPath, '--repo', repoPath];
  if (mode && mode !== 'both') args.push('--mode', mode);
  if (indexRoot) args.push('--index-root', indexRoot);
  return args;
};
