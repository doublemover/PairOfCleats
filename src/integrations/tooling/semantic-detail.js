export { classifySemanticDetailError } from './semantic-errors.js';
import { createSemanticDetailService, getSemanticDetailBudgetUsage } from '../../semantic/detail.js';
import { openPublishedSemanticStore } from '../../semantic/published-store.js';
import { normalizeSemanticConfig } from '../../index/semantic/config.js';
import { assertSemanticQuery } from '../../contracts/validators/semantic-query.js';
import { resolveSemanticGenerationIndexDir } from '../../semantic/generation.js';
import { getRepoRoot } from '../../shared/repo-paths.js';
import { loadUserConfig } from '../../shared/dict-utils.js';
import { canonicalSemanticJson } from '../../index/semantic/identity.js';
import { throwIfAborted } from '../../shared/abort.js';
import { openPublishedSymbolicTypeStore } from '../../semantic/symbolic-type-store.js';
import { measureSymbolicResponseBytes } from '../../semantic/symbolic-type-response.js';

/** One cursor service per repository/query policy; stores reopen the exact requested generation. */
export const createSemanticDetailRunner = ({ openStore = openPublishedSemanticStore,
  openTypeStore = openPublishedSymbolicTypeStore, maxServices = 32 } = {}) => {
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
    for (const [name, max] of Object.entries({ records: options.maxRecords, rows: options.maxRows,
      bytes: options.maxBytes, workMs: options.maxWorkMs })) {
      if (request.limits?.[name] > max) throw Object.assign(new Error('Requested ' + name + ' exceeds configured semantic limits.'), { code: 'ERR_SEMANTIC_QUERY_LIMIT' });
    }
    const key = request.repoRoot + '\0' + canonicalSemanticJson(options);
    let service = services.get(key);
    if (!service) {
      service = createSemanticDetailService(options);
      services.set(key, service);
      while (services.size > maxServices) services.delete(services.keys().next().value);
    }
    const deadlineAtMs = request.typeQueries ? performance.now() + (request.limits?.workMs || options.maxWorkMs) : null;
    const indexDir = await resolveSemanticGenerationIndexDir({ repoRoot: request.repoRoot, generation: request.generation, userConfig: config });
    let result;
    if (request.refs.length || !request.typeQueries) {
      const { store } = await openStore({ indexDir, repoRoot: request.repoRoot, generation: request.generation,
        requireQueryIndex: Boolean(request.include?.some(value => ['operands', 'names', 'ownership'].includes(value))) });
      throwIfAborted(signal);
      result = await service({ store, request, signal });
    } else result = { schemaVersion: 1, generation: request.generation, status: 'complete', records: [],
      edges: [], operands: [], ownership: [], names: [], evidenceRefs: [], frontier: [], cursor: null, warnings: [],
      coverage: { extraction: [], analysis: [], response: { state: 'complete', returnedCount: 0, hydratedCount: 0 } } };
    if (request.include?.includes('providerEvidence') && !result.providerEvidence) result.providerEvidence = [];
    if (request.typeQueries) {
      if (request.cursor) throw Object.assign(new Error('Type queries cannot be combined with semantic detail continuations.'), { code: 'ERR_SEMANTIC_QUERY_CONTRACT' });
      if (result.cursor) throw Object.assign(new Error('Mixed type/detail response requires pagination; query types separately.'), { code: 'ERR_SEMANTIC_OUTPUT_LIMIT' });
      result.typeResults = [];
      const outputLimit = (request.limits?.bytes || options.maxBytes) - getSemanticDetailBudgetUsage(result).retainedEvidenceBytes;
      let responseBytes = measureSymbolicResponseBytes(result, outputLimit);
      const typeStore = await openTypeStore({ indexDir, repoRoot: request.repoRoot, generation: request.generation, signal });
      for (const typeQuery of request.typeQueries) {
        const separatorBytes = result.typeResults.length ? 1 : 0;
        const remaining = outputLimit - responseBytes - separatorBytes;
        const envelope = typeQuery.operation === 'classify'
          ? { ref: typeQuery.ref, operation: 'classify', cardinality: 'many', witnesses: [], complete: true }
          : { ref: typeQuery.ref, operation: 'membership', contains: false, complete: true };
        const overhead = measureSymbolicResponseBytes(envelope, remaining);
        const maxWitnessBytes = Math.max(0, remaining - overhead - 5);
        const value = await typeStore.query(typeQuery, { deadlineAtMs,
          ...(typeQuery.operation === 'classify' ? { maxWitnessBytes } : {}), budget: { maxInputChars: 16384 } });
        const valueBytes = measureSymbolicResponseBytes(value, remaining);
        responseBytes += separatorBytes + valueBytes;
        result.typeResults.push(value);
      }
    }
    return assertSemanticQuery('detailResult', result);
  };
};
export const runSemanticDetail = createSemanticDetailRunner();
