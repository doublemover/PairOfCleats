import { openPublishedSemanticStore } from '../semantic/published-store.js';
import { runSemanticFind } from '../integrations/tooling/semantic-find.js';
import { runSemanticDetail } from '../integrations/tooling/semantic-detail.js';
import { runSemanticTrace } from '../integrations/tooling/semantic-trace.js';
import { normalizeSemanticConfig } from '../index/semantic/config.js';
import { throwIfAborted } from '../shared/abort.js';
import { observeStorageResource } from '../shared/storage/failure-observation.js';
import { withSemanticReaderCleanup } from '../semantic/reader-lifetime.js';
import { assertSemanticEnvelope } from '../contracts/validators/semantic-envelopes.js';

const failureCode = error => {
  const observation = observeStorageResource(error, { phase: 'semantic-context-section' });
  observation.requireSettled();
  let code;
  try { code = error?.code; }
  catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true }); }
  observation.requireSettled();
  return code;
};

const unavailable = new Set(['ERR_SEMANTIC_UNAVAILABLE', 'ERR_SEMANTIC_QUERY_INDEX_UNAVAILABLE', 'ERR_INDEX_FORMAT_UNSUPPORTED', 'ENOENT']);
/** Bounded retrieval composition only. Never schedules enrichment or reads live source. */
export const buildSemanticContextSection = async ({ repoRoot, indexDir, primary, userConfig = {}, signal = null,
  openStore = openPublishedSemanticStore, find = runSemanticFind, detail = runSemanticDetail, trace = runSemanticTrace }) => {
  throwIfAborted(signal);
  const result = { schemaVersion: 1, repoRoot, generation: null, status: 'unavailable',
    selector: null, discovery: null, detail: null, trace: null, excerpts: [], followUps: [], warnings: [] };
  const chunkUid = primary?.ref?.chunkUid;
  const sourcePath = primary?.file;
  result.selector = chunkUid ? { field: 'chunkUid', value: chunkUid }
    : sourcePath ? { field: 'sourcePath', value: sourcePath } : null;
  if (!result.selector) { result.warnings.push('No resolved chunk or retained source path is available for semantic discovery.'); return result; }
  const query = normalizeSemanticConfig(userConfig.indexing?.semantic).query;
  const limits = (bytes, records) => ({ bytes: Math.min(bytes, query.maxBytes), records: Math.min(records, query.maxRecords), workMs: Math.min(50, query.maxWorkMs) });
  throwIfAborted(signal);
  const optional = async run => {
    try { return await run(); }
    catch (error) {
      const code = failureCode(error);
      if (!unavailable.has(code)) throw error;
      result.warnings.push(code + ': semantic family or physical lookup index is unavailable; rebuild or select its pinned generation.');
      return null;
    }
  };
  const opened = await optional(() => openStore({ repoRoot, indexDir, requireQueryIndex: true, signal }));
  if (opened) {
    const { store } = opened;
    const close = opened.close?.bind(opened);
    await withSemanticReaderCleanup(() => optional(async () => {
      throwIfAborted(signal);
      const generation = Object.freeze({ ...assertSemanticEnvelope('generation', store.generation) });
      result.generation = generation;
      const scope = { repoRoot, generation };
      const options = { signal, userConfig };
      const findRequest = { ...scope, selector: result.selector, limits: limits(8192, 8) };
      result.discovery = await find(findRequest, options);
      result.followUps.push({ operation: 'semantic_find', request: { ...findRequest, ...(result.discovery.cursor ? { cursor: result.discovery.cursor } : {}) } });
      const refs = result.discovery.records.map(row => row.ref);
      if (refs.length) {
        const detailRequest = { ...scope, refs, include: ['operands', 'names', 'ownership'],
          limits: { ...limits(16384, 32), rows: Math.min(48, query.maxRows) } };
        result.detail = await detail(detailRequest, options);
        result.followUps.push({ operation: 'semantic_detail', request: { ...detailRequest, ...(result.detail.cursor ? { cursor: result.detail.cursor } : {}) } });
        const operation = result.discovery.records.find(row => row.data?.invocationKind) || result.discovery.records[0];
        const traceRequest = { ...scope, seed: operation.ref, direction: 'downstream',
          limits: { ...limits(8192, 12), edges: Math.min(16, query.maxRows), depth: Math.min(2, query.maxDepth) } };
        result.trace = await trace(traceRequest, options);
        result.followUps.push({ operation: 'semantic_trace', request: { ...traceRequest, ...(result.trace.cursor ? { cursor: result.trace.cursor } : {}) } });
        if (store.getSourceSpans) {
          try { result.excerpts = (await store.getSourceSpans([operation.ref], { signal, maxBytes: 2048 })).filter(Boolean); }
          catch (error) {
            if (failureCode(error) !== 'ERR_SEMANTIC_OUTPUT_LIMIT') throw error;
            result.warnings.push('Retained source excerpt exceeds the context hydration allowance; exact record/span remains available.');
          }
        }
      }
      result.status = 'partial';
      result.warnings.push('Bounded operation/argument and downstream witness sample; not a complete call graph or behavioral-equivalence claim. Follow-up requests preserve repository, generation and query scope.');
      throwIfAborted(signal);
    }), () => close?.());
  }
  throwIfAborted(signal);
  if (Buffer.byteLength(JSON.stringify(result)) > 65536) throw Object.assign(new Error('Semantic context exceeds its 64 KiB envelope.'), { code: 'ERR_SEMANTIC_OUTPUT_LIMIT' });
  return result;
};
