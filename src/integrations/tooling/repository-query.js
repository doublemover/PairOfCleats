import { createRepositoryQuestionService } from '../../semantic/questions/execute.js';
import { openSemanticQueryStore } from '../../semantic/query-store.js';
import { createSemanticContinuationBudget } from '../../semantic/continuation-budget.js';
import { normalizeSemanticConfig } from '../../index/semantic/config.js';
import { resolveSemanticGenerationIndexDir } from '../../semantic/generation.js';
import { getRepoRoot } from '../../shared/repo-paths.js';
import { loadUserConfig } from '../../shared/dict-utils.js';
import { canonicalSemanticJson } from '../../index/semantic/identity.js';
import { throwIfAborted } from '../../shared/abort.js';
import { captureSemanticRequest } from '../../semantic/request-snapshot.js';
import { REPOSITORY_QUERY_REQUEST_SCHEMA } from '../../contracts/schemas/repository-question-live.js';
import { assertRepositoryQuery } from '../../contracts/validators/repository-question-live.js';
import { withSemanticReaderCleanup } from '../../semantic/reader-lifetime.js';
import { publishSemanticPage } from '../../semantic/page-publication.js';

/** Each page reopens the requested immutable generation and settles its actual
 * original readers before publishing any new continuation. Aggregate retention
 * shares the existing semantic budget; cache eviction retires cursor leases.
 */
export const createRepositoryQueryRunner = ({ openStore = openSemanticQueryStore,
  resolveIndexDir = resolveSemanticGenerationIndexDir, maxServices = 32 } = {}) => {
  if (!Number.isSafeInteger(maxServices) || maxServices < 1 || maxServices > 64) throw new TypeError('Invalid repository query service cache bound.');
  const services = new Map(), retentionBudget = createSemanticContinuationBudget();
  return async (input, { signal = null, userConfig = null } = {}) => {
    let request = captureSemanticRequest(input, REPOSITORY_QUERY_REQUEST_SCHEMA);
    assertRepositoryQuery('request', request); throwIfAborted(signal);
    const repoRoot = getRepoRoot(request.repoRoot);
    if (repoRoot !== request.repoRoot) request = captureSemanticRequest({ ...request, repoRoot }, REPOSITORY_QUERY_REQUEST_SCHEMA);
    const config = userConfig || loadUserConfig(repoRoot), query = normalizeSemanticConfig(config.indexing?.semantic).query;
    const options = { maxRecords: query.maxRecords, maxBytes: query.maxBytes, maxWorkMs: query.maxWorkMs,
      maxContinuations: query.maxContinuations, ttlMs: query.cursorTtlMs };
    const key = repoRoot + '\0' + canonicalSemanticJson(options);
    let service = services.get(key);
    if (!service) {
      service = createRepositoryQuestionService({ ...options, retentionBudget }); services.set(key, service);
      while (services.size > maxServices) {
        const retired = services.keys().next().value;
        services.get(retired).dispose(); services.delete(retired);
      }
    }
    const indexDir = await resolveIndexDir({ repoRoot, generation: request.generation, userConfig: config, signal });
    const opened = await openStore({ indexDir, repoRoot, generation: request.generation, requireQueryIndex: true,
      backend: request.backend || 'artifact', signal });
    const close = opened.close?.bind(opened);
    const result = await withSemanticReaderCleanup(async () => {
      throwIfAborted(signal);
      const value = await service({ store: opened.store, request, signal, deferPublication: true });
      throwIfAborted(signal);
      assertRepositoryQuery(request.mode === 'describe' ? 'description' : 'page', value);
      return value;
    }, () => close?.());
    throwIfAborted(signal);
    return publishSemanticPage(result);
  };
};
export const runRepositoryQuery = createRepositoryQueryRunner();
