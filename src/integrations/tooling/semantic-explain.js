import { createSemanticExplainService } from '../../semantic/explain.js';
import { openPublishedSemanticStore } from '../../semantic/published-store.js';
import { normalizeSemanticConfig } from '../../index/semantic/config.js';
import { assertSemanticExplain } from '../../contracts/validators/semantic-explain.js';
import { resolveSemanticGenerationIndexDir } from '../../semantic/generation.js';
import { getRepoRoot } from '../../shared/repo-paths.js';
import { loadUserConfig } from '../../shared/dict-utils.js';
import { canonicalSemanticJson } from '../../index/semantic/identity.js';
import { throwIfAborted } from '../../shared/abort.js';

/** One cursor service per repository/query policy; stores reopen the exact requested generation. */
export const createSemanticExplainRunner = ({ openStore = openPublishedSemanticStore, maxServices = 32 } = {}) => {
  if (!Number.isSafeInteger(maxServices) || maxServices < 1 || maxServices > 64) throw new TypeError('Invalid semantic service cache bound.');
  const services = new Map();
  return async (request, { signal = null, userConfig = null } = {}) => {
    assertSemanticExplain('request', request);
    throwIfAborted(signal);
    request = { ...request, repoRoot: getRepoRoot(request.repoRoot) };
    const config = userConfig || loadUserConfig(request.repoRoot);
    const query = normalizeSemanticConfig(config.indexing?.semantic).query;
    const options = { maxRecords: query.maxRecords, maxEdges: query.maxRows, maxDepth: query.maxDepth, maxBytes: query.maxBytes,
      maxWorkMs: query.maxWorkMs, maxContinuations: query.maxContinuations, ttlMs: query.cursorTtlMs };
    const key = request.repoRoot + '\0' + canonicalSemanticJson(options);
    let service = services.get(key);
    if (!service) {
      service = createSemanticExplainService(options);
      services.set(key, service);
      while (services.size > maxServices) services.delete(services.keys().next().value);
    }
    const indexDir = await resolveSemanticGenerationIndexDir({ repoRoot: request.repoRoot, generation: request.generation, userConfig: config });
    const { store } = await openStore({ indexDir, repoRoot: request.repoRoot, generation: request.generation,
      requireQueryIndex: true });
    throwIfAborted(signal);
    return service({ store, request, signal });
  };
};
export const runSemanticExplain = createSemanticExplainRunner();
