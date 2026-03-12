import { loadUserConfig } from '../../../shared/dict-utils.js';
import { resolveIndexDir } from '../../../../src/retrieval/cli-index.js';
import { hasIndexMeta } from '../../../../src/retrieval/cli/index-loader.js';
import { createError, ERROR_CODES } from '../../../../src/shared/error-codes.js';
import { normalizeRiskFilters, validateRiskFilters } from '../../../../src/shared/risk-filters.js';
import { buildRiskExplainPayload } from '../../../analysis/explain-risk.js';
import { resolveRepoPath } from '../../repo.js';

export async function runRiskExplain(args = {}, context = {}) {
  if (context.signal?.aborted) {
    throw createError(ERROR_CODES.CANCELLED, 'Request cancelled.');
  }
  const repoPath = resolveRepoPath(args.repoPath);
  const chunkUid = String(args.chunk || '').trim();
  if (!chunkUid) {
    throw createError(ERROR_CODES.INVALID_REQUEST, 'chunk is required.');
  }
  const userConfig = loadUserConfig(repoPath);
  const indexDir = resolveIndexDir(repoPath, 'code', userConfig);
  if (!hasIndexMeta(indexDir)) {
    throw createError(ERROR_CODES.NO_INDEX, `Code index not found at ${indexDir}.`);
  }
  const filters = normalizeRiskFilters(args.filters || null);
  const validation = validateRiskFilters(filters);
  if (!validation.ok) {
    throw createError(ERROR_CODES.INVALID_REQUEST, `Invalid risk filters: ${validation.errors.join('; ')}`);
  }
  if (typeof context.progress === 'function') {
    context.progress({ phase: 'start', message: 'Building risk explanation.' });
  }
  const result = await buildRiskExplainPayload({
    indexDir,
    chunkUid,
    max: args.max,
    filters
  });
  if (typeof context.progress === 'function') {
    context.progress({ phase: 'done', message: 'Risk explanation ready.' });
  }
  return result;
}
