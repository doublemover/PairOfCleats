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
import { compileRepositoryQuestion } from '../../semantic/questions/compile.js';
import { checkCurrentReaderQuestionShape } from '../../semantic/questions/current-reader-profile.js';

const preparedRequests = new WeakSet();
/** Grammar/cost preflight only; world, config and permission admission remain
 * fresh at the opened reader. Only this owner's deep snapshots are reusable. */
export const captureRepositoryQueryRequest = input => {
  if (preparedRequests.has(input)) return input;
  const request = captureSemanticRequest(input, REPOSITORY_QUERY_REQUEST_SCHEMA);
  if (preparedRequests.has(request)) return request;
  assertRepositoryQuery('request', request); canonicalSemanticJson(request, { maxBytes: 512 * 1024 });
  if (request.mode !== 'describe') {
    const plan = compileRepositoryQuestion(request.question);
    if (plan.status !== 'compiled') throw Object.assign(new Error('Repository question compilation rejected the requested clauses.'), { code: 'ERR_SEMANTIC_QUERY_CONTRACT', diagnostics: plan.diagnostics });
    checkCurrentReaderQuestionShape(plan);
  }
  preparedRequests.add(request); return request;
};

/** Each page reopens the requested immutable generation and settles its actual
 * original readers before publishing any new continuation. Aggregate retention
 * shares the existing semantic budget; cache eviction retires cursor leases.
 */
export const createRepositoryQueryRunner = ({ openStore = openSemanticQueryStore,
  resolveIndexDir = resolveSemanticGenerationIndexDir, maxServices = 32 } = {}) => {
  if (!Number.isSafeInteger(maxServices) || maxServices < 1 || maxServices > 64) throw new TypeError('Invalid repository query service cache bound.');
  const services = new Map(), retentionBudget = createSemanticContinuationBudget();
  return async (input, { signal = null, userConfig = null, deferPublication = false } = {}) => {
    let request = captureRepositoryQueryRequest(input);
    throwIfAborted(signal);
    const repoRoot = getRepoRoot(request.repoRoot);
    if (repoRoot !== request.repoRoot) request = captureRepositoryQueryRequest({ ...request, repoRoot });
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
      assertRepositoryQuery(request.mode === 'describe' ? 'description' : request.mode === 'explain' ? 'explanation' : 'page', value);
      return value;
    }, () => close?.());
    throwIfAborted(signal);
    // Trusted composed consumers finish their own projection before publishing
    // this capability. This internal option is absent from every request schema.
    return deferPublication ? result : publishSemanticPage(result);
  };
};
export const runRepositoryQuery = createRepositoryQueryRunner();
