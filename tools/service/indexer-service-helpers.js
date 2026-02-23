import path from 'node:path';
import { getIndexDir, loadUserConfig } from '../shared/dict-utils.js';

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
