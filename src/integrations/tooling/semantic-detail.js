import { createSemanticDetailService } from '../../semantic/detail.js';
import { openPublishedSemanticStore } from '../../semantic/published-store.js';
import { normalizeSemanticConfig } from '../../index/semantic/config.js';
import { assertSemanticQuery } from '../../contracts/validators/semantic-query.js';
import { resolveSemanticGenerationIndexDir } from '../../semantic/generation.js';
import { getRepoRoot } from '../../shared/repo-paths.js';
import { loadUserConfig } from '../../shared/dict-utils.js';
import { canonicalSemanticJson } from '../../index/semantic/identity.js';
import { throwIfAborted } from '../../shared/abort.js';

/** One cursor service per repository/query policy; stores reopen the exact requested generation. */
export const createSemanticDetailRunner = ({ openStore = openPublishedSemanticStore, maxServices = 32 } = {}) => {
  if (!Number.isSafeInteger(maxServices) || maxServices < 1 || maxServices > 64) throw new TypeError('Invalid semantic service cache bound.');
  const services = new Map();
  return async (request, { signal = null, userConfig = null } = {}) => {
    assertSemanticQuery('detailRequest', request);
    throwIfAborted(signal);
    request = { ...request, repoRoot: getRepoRoot(request.repoRoot) };
    const config = userConfig || loadUserConfig(request.repoRoot);
    const query = normalizeSemanticConfig(config.indexing?.semantic).query;
    const options = { maxRecords: query.maxRecords, maxRows: query.maxRows, maxBytes: query.maxBytes,
      maxWorkMs: query.maxWorkMs, maxContinuations: query.maxContinuations, ttlMs: query.cursorTtlMs };
    const key = request.repoRoot + '\0' + canonicalSemanticJson(options);
    let service = services.get(key);
    if (!service) {
      service = createSemanticDetailService(options);
      services.set(key, service);
      while (services.size > maxServices) services.delete(services.keys().next().value);
    }
    const indexDir = await resolveSemanticGenerationIndexDir({ repoRoot: request.repoRoot, generation: request.generation, userConfig: config });
    const { store } = await openStore({ indexDir, repoRoot: request.repoRoot, generation: request.generation,
      requireQueryIndex: Boolean(request.include?.length) });
    throwIfAborted(signal);
    return service({ store, request, signal });
  };
};
export const runSemanticDetail = createSemanticDetailRunner();
export const classifySemanticDetailError = (error) => {
  const semanticCode = error?.code || 'ERR_SEMANTIC_DETAIL';
  const status = ['ERR_SEMANTIC_QUERY_CONTRACT', 'ERR_SEMANTIC_QUERY_LIMIT', 'ERR_SEMANTIC_OUTPUT_LIMIT'].includes(semanticCode) ? 400
    : semanticCode === 'ERR_SEMANTIC_CURSOR_EXPIRED' ? 410
      : semanticCode === 'ERR_SEMANTIC_SCOPE_MISMATCH' ? 403
        : ['ERR_INDEX_FORMAT_UNSUPPORTED', 'ERR_SEMANTIC_GENERATION_MISMATCH'].includes(semanticCode) ? 409
          : ['ERR_SEMANTIC_UNAVAILABLE', 'ERR_SEMANTIC_QUERY_INDEX_UNAVAILABLE', 'ENOENT', 'NO_INDEX'].includes(semanticCode) ? 404
            : error?.name === 'AbortError' || semanticCode === 'ERR_ABORTED' ? 499 : 500;
  return { status, semanticCode, message: error?.message || 'Semantic detail failed.', ...(error?.details ? { details: error.details } : {}) };
};
