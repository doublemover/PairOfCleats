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
export { classifySemanticEnrichmentError } from './semantic-enrichment-errors.js';
