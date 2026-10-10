import { randomUUID } from 'node:crypto';
import { canonicalSemanticJson, semanticHash } from '../index/semantic/identity.js';
import { assertSemanticEnvelope } from '../contracts/validators/semantic-envelopes.js';
import { assertSemanticQuery } from '../contracts/validators/semantic-query.js';
import { throwIfAborted } from '../shared/abort.js';

const fail = (code, message) => Object.assign(new Error(message), { code });
/** Shared bounded detail service. Construct once per service, not once per page. */
export const createSemanticDetailService = ({ maxContinuations = 64, ttlMs = 300000 } = {}) => {
  const continuations = new Map();
  return async ({ store, request, signal = null }) => {
    assertSemanticQuery('detailRequest', request);
    assertSemanticEnvelope('generation', request.generation);
    if (canonicalSemanticJson(request.generation) !== canonicalSemanticJson(store.generation)) {
      throw fail('ERR_SEMANTIC_GENERATION_MISMATCH', 'Requested semantic generation differs from the pinned store.');
    }
    if (typeof request.repoRoot !== 'string' || !request.repoRoot) throw new TypeError('Repository scope is required.');
    if (request.repoRoot !== store.repoRoot) throw fail('ERR_SEMANTIC_SCOPE_MISMATCH', 'Requested repository differs from the store scope.');
    const fields = request.fields || ['span', 'scope', 'data'];
    if (!Array.isArray(fields) || fields.some((field) => !['span', 'scope', 'data'].includes(field))) throw new TypeError('Unknown semantic field group.');
    const limits = { records: 128, bytes: 65536, workMs: 250, ...request.limits };
    for (const [key, max] of Object.entries({ records: 128, bytes: 65536, workMs: 250 })) {
      if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > max) throw new TypeError('Invalid semantic ' + key + ' limit.');
    }
    if (Object.keys(limits).some((key) => !['records', 'bytes', 'workMs'].includes(key))) throw new TypeError('Unknown semantic limit.');
    const key = semanticHash('semantic.detail-continuation.v1', { repoRoot: request.repoRoot, generation: request.generation, refs: request.refs, fields, limits });
    let offset = 0;
    if (request.cursor) {
      const saved = continuations.get(request.cursor);
      if (!saved || saved.key !== key || saved.expires < Date.now()) {
        throw fail('ERR_SEMANTIC_CURSOR_EXPIRED', 'Restart semantic detail with the pinned generation and original request; continuation is expired or mismatched.');
      }
      offset = saved.offset;
    }
    const began = performance.now();
    throwIfAborted(signal);
    const selected = request.refs.slice(offset, offset + limits.records);
    const rows = await store.getRecords(selected, fields, { signal });
    const result = { schemaVersion: 1, generation: request.generation, status: 'partial', records: [], edges: [], evidenceRefs: [],
      coverage: { extraction: [], analysis: [], response: { state: 'partial', returnedCount: 0 } },
      frontier: [], cursor: null, warnings: [] };
    const coverage = await store.getCoverage(selected.map((ref) => ref.partitionId), { signal });
    result.coverage.extraction = coverage.filter((row) => row.phase === 'syntax');
    result.coverage.analysis = coverage.filter((row) => row.phase !== 'syntax');
    let processed = 0;
    for (let i = 0; i < rows.length; i += 1) {
      throwIfAborted(signal);
      if (processed && performance.now() - began >= limits.workMs) break;
      const row = rows[i];
      if (row) result.records.push(row);
      else result.frontier.push({ ref: selected[i], reason: 'record_not_found' });
      // Leave bounded room for the cursor, counters and response frontier.
      if (Buffer.byteLength(JSON.stringify(result)) + 512 > limits.bytes) {
        if (row) result.records.pop(); else result.frontier.pop();
        if (!processed) throw fail('ERR_SEMANTIC_OUTPUT_LIMIT', 'Selected record cannot fit the output budget; select fewer field groups.');
        break;
      }
      processed += 1;
    }
    offset += processed;
    const done = offset === request.refs.length;
    result.coverage.response = { state: done ? 'complete' : 'partial', returnedCount: result.records.length };
    // Empty arrays must never masquerade as complete extraction/analysis coverage.
    const analysisComplete = result.coverage.analysis.length > 0 && result.coverage.analysis.every((row) => row.state === 'complete');
    const extractionComplete = result.coverage.extraction.length > 0 && result.coverage.extraction.every((row) => row.state === 'complete');
    result.status = done && analysisComplete && extractionComplete && !result.frontier.length ? 'complete' : 'partial';
    if (!done) {
      const cursor = randomUUID();
      continuations.set(cursor, { key, offset, expires: Date.now() + ttlMs });
      while (continuations.size > maxContinuations) continuations.delete(continuations.keys().next().value);
      result.cursor = cursor;
      result.frontier.push({ reason: 'response_budget', remainingCount: request.refs.length - offset });
    }
    if (Buffer.byteLength(JSON.stringify(result)) > limits.bytes) throw fail('ERR_SEMANTIC_OUTPUT_LIMIT', 'Coverage envelope exceeds output budget.');
    return assertSemanticQuery('detailResult', result);
  };
};
