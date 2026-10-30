import { createSemanticExplainService } from '../../semantic/explain.js';
import { openSemanticQueryStore } from '../../semantic/query-store.js';
import { normalizeSemanticConfig } from '../../index/semantic/config.js';
import { assertSemanticExplain } from '../../contracts/validators/semantic-explain.js';
import { resolveSemanticGenerationIndexDir } from '../../semantic/generation.js';
import { getRepoRoot } from '../../shared/repo-paths.js';
import { loadUserConfig } from '../../shared/dict-utils.js';
import { canonicalSemanticJson } from '../../index/semantic/identity.js';
import { throwIfAborted } from '../../shared/abort.js';
import { captureSemanticRequest } from '../../semantic/request-snapshot.js';
import { SEMANTIC_EXPLAIN_REQUEST_SCHEMA } from '../../contracts/schemas/semantic-explain.js';
import { withSemanticReaderCleanup } from '../../semantic/reader-lifetime.js';
import { publishSemanticPage } from '../../semantic/page-publication.js';
import { createTraceContinuationBudget } from '../../semantic/trace-continuation-state.js';

/** One cursor service per repository/query policy; stores reopen the exact requested generation. */
export const createSemanticExplainRunner = ({ openStore = openSemanticQueryStore, maxServices = 32 } = {}) => {
  if (!Number.isSafeInteger(maxServices) || maxServices < 1 || maxServices > 64) throw new TypeError('Invalid semantic service cache bound.');
  const services = new Map();
  const retentionBudget = createTraceContinuationBudget();
  return async (request, { signal = null, userConfig = null } = {}) => {
    request = captureSemanticRequest(request, SEMANTIC_EXPLAIN_REQUEST_SCHEMA);
    assertSemanticExplain('request', request);
    throwIfAborted(signal);
    const repoRoot = getRepoRoot(request.repoRoot);
    if (repoRoot !== request.repoRoot) request = captureSemanticRequest({ ...request, repoRoot }, SEMANTIC_EXPLAIN_REQUEST_SCHEMA);
    const config = userConfig || loadUserConfig(request.repoRoot);
    const query = normalizeSemanticConfig(config.indexing?.semantic).query;
    const options = { maxRecords: query.maxRecords, maxEdges: query.maxRows, maxDepth: query.maxDepth, maxBytes: query.maxBytes,
      maxWorkMs: query.maxWorkMs, maxContinuations: query.maxContinuations, ttlMs: query.cursorTtlMs };
    const key = request.repoRoot + '\0' + canonicalSemanticJson(options);
    let service = services.get(key);
    if (!service) {
      service = createSemanticExplainService({ ...options, retentionBudget });
      services.set(key, service);
      while (services.size > maxServices) {
        const oldest = services.keys().next().value; services.get(oldest).dispose(); services.delete(oldest);
      }
    }
    const indexDir = await resolveSemanticGenerationIndexDir({ repoRoot: request.repoRoot, generation: request.generation, userConfig: config, signal });
    const opened = await openStore({ indexDir, repoRoot: request.repoRoot, generation: request.generation,
      requireQueryIndex: true, backend: request.backend || 'artifact', signal });
    const close = opened.close?.bind(opened);
    const result = await withSemanticReaderCleanup(async () => {
      throwIfAborted(signal);
      const value = await service({ store: opened.store, manifest: opened.manifest, request, signal, deferPublication: true });
      throwIfAborted(signal);
      return value;
    }, () => close?.());
    throwIfAborted(signal);
    return publishSemanticPage(result);
  };
};
export const runSemanticExplain = createSemanticExplainRunner();
