import { createSemanticFindService } from '../../semantic/find.js';
import { openSemanticQueryStore } from '../../semantic/query-store.js';
import { normalizeSemanticConfig } from '../../index/semantic/config.js';
import { assertSemanticFind } from '../../contracts/validators/semantic-find.js';
import { resolveSemanticGenerationIndexDir } from '../../semantic/generation.js';
import { getRepoRoot } from '../../shared/repo-paths.js';
import { loadUserConfig } from '../../shared/dict-utils.js';
import { canonicalSemanticJson } from '../../index/semantic/identity.js';
import { throwIfAborted } from '../../shared/abort.js';
import { captureSemanticRequest } from '../../semantic/request-snapshot.js';
import { SEMANTIC_FIND_REQUEST_SCHEMA } from '../../contracts/schemas/semantic-find.js';
import { withSemanticReaderCleanup } from '../../semantic/reader-lifetime.js';
import { publishSemanticPage } from '../../semantic/page-publication.js';

/** One cursor service per repository/query policy; stores reopen the exact requested generation. */
export const createSemanticFindRunner = ({ openStore = openSemanticQueryStore, maxServices = 32 } = {}) => {
  if (!Number.isSafeInteger(maxServices) || maxServices < 1 || maxServices > 64) throw new TypeError('Invalid semantic service cache bound.');
  const services = new Map();
  return async (request, { signal = null, userConfig = null } = {}) => {
    request = captureSemanticRequest(request, SEMANTIC_FIND_REQUEST_SCHEMA);
    assertSemanticFind('request', request);
    throwIfAborted(signal);
    const repoRoot = getRepoRoot(request.repoRoot);
    if (repoRoot !== request.repoRoot) request = captureSemanticRequest({ ...request, repoRoot }, SEMANTIC_FIND_REQUEST_SCHEMA);
    const config = userConfig || loadUserConfig(request.repoRoot);
    const query = normalizeSemanticConfig(config.indexing?.semantic).query;
    const options = { maxRecords: query.maxRecords, maxBytes: query.maxBytes,
      maxWorkMs: query.maxWorkMs, maxContinuations: query.maxContinuations, ttlMs: query.cursorTtlMs };
    const key = request.repoRoot + '\0' + canonicalSemanticJson(options);
    let service = services.get(key);
    if (!service) {
      service = createSemanticFindService(options);
      services.set(key, service);
      while (services.size > maxServices) services.delete(services.keys().next().value);
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
export const runSemanticFind = createSemanticFindRunner();
