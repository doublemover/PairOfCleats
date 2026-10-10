import { assertSemanticEnrichment } from '../../contracts/validators/semantic-enrichment.js';
import { runSemanticEnrichmentService } from '../../semantic/enrichment.js';
import { getRepoRoot } from '../../shared/repo-paths.js';
import { loadUserConfig } from '../../shared/dict-utils.js';
import { throwIfAborted } from '../../shared/abort.js';
export const runSemanticEnrichment = async (request, { signal = null, userConfig = null } = {}) => {
  assertSemanticEnrichment('request', request); throwIfAborted(signal);
  const repoRoot = getRepoRoot(request.repoRoot);
  return runSemanticEnrichmentService({ request: { ...request, repoRoot }, userConfig: userConfig || loadUserConfig(repoRoot), signal });
};
export const classifySemanticEnrichmentError = error => {
  const code = error.code || 'ERR_SEMANTIC_ENRICHMENT_FAILED';
  const status = code === 'ERR_SEMANTIC_UNAVAILABLE' || code === 'ENOENT' ? 404
    : code === 'ERR_SEMANTIC_ENRICHMENT_AUTHORITY' ? 403
      : code === 'ERR_SEMANTIC_ENRICHMENT_BUDGET' ? 422 : code === 'ABORT_ERR' ? 499
        : ['ERR_SEMANTIC_ENRICHMENT_STALE', 'ERR_SEMANTIC_GENERATION_MISMATCH', 'ERR_SEMANTIC_LEASE_LOST',
          'ERR_SEMANTIC_PUBLICATION_REQUIRED', 'ERR_SEMANTIC_INTEGRITY'].includes(code) ? 409
          : code.endsWith('_CONTRACT') || error instanceof TypeError ? 400 : 500;
  return { status, code, message: error.message };
};
