import { createHash } from 'node:crypto';
import { stableStringify } from '../../shared/stable-json.js';
import { createAbortError, throwIfAborted } from '../../shared/abort.js';
import { buildRetrievalHitKey } from '../hit-comparison.js';
import { pendingRerankerWorkFailure, trackRerankerWork } from '../rerankers/failure-ownership.js';
import { classifyRerankerError } from './reranker-error-classification.js';

const digest = value => createHash('sha256').update(stableStringify(value)).digest('hex');
const freeze = (value, depth = 0) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (depth > 64) throw new RangeError('Reranker member snapshot exceeds64 nesting levels.');
  for (const item of Object.values(value)) freeze(item, depth + 1);
  return Object.freeze(value);
};
const cancelled = () => Object.assign(createAbortError('Reranker cancelled'), { cancelled: true });

/** Adapters only score a request-owned snapshot. Timeout fallback isolates late
 * work, retaining actual adapter ownership until its own settlement confirms.
 * Legacy direct calls reject errors unless fallback is explicitly requested. */
export const rerankEvidence = async ({ adapter, query, hits, signal, maxMs = 2000,
  finalOutputCap = hits.length, policyKey = null, sourceContext = null,
  fallback = false, onDiagnostic = null }) => {
  throwIfAborted(signal, 'Reranker cancelled');
  if (!adapter) return hits;
  if (!adapter.id || typeof adapter.rerank !== 'function') throw new TypeError('Reranker requires id and rerank');
  if (!Array.isArray(hits) || hits.length > 64) throw new RangeError('Reranker evidence window exceeds64');
  if (!Number.isSafeInteger(finalOutputCap) || finalOutputCap < 0 || finalOutputCap > 64
    || !Number.isSafeInteger(maxMs) || maxMs < 1 || maxMs > 10000) throw new RangeError('Invalid reranker output/deadline cap.');
  const controller = new AbortController();
  let timer, rejectCancelled, work = null, tracked = null, timedOut = false, members = null;
  const cancel = () => { controller.abort(signal?.reason); rejectCancelled?.(cancelled()); };
  const cancellation = new Promise((_, reject) => { rejectCancelled = reject; });
  signal?.addEventListener('abort', cancel, { once: true });
  const diagnostic = { schemaVersion: 1, adapter: adapter.id, adapterIdentity: adapter.identityKey ?? null,
    policyKey, pool: hits.length, finalOutputCap, status: 'not-started', pending: false, reason: null, resultIdentity: null };
  const attach = (output, settlement = null) => {
    Object.defineProperty(output, 'rerankDiagnostic', { value: Object.freeze({ ...diagnostic }) });
    if (settlement) Object.defineProperties(output, { rerankerSettlement: { value: settlement }, rerankerOwner: { value: adapter } });
    onDiagnostic?.({ ...diagnostic });
    return output;
  };
  try {
    if (signal?.aborted) throw cancelled();
    if (!hits.length) { diagnostic.status = 'empty'; return attach([]); }
    if (Buffer.byteLength(JSON.stringify(hits)) > 2 * 1024 * 1024) throw new RangeError('Reranker member snapshot exceeds2MiB.');
    members = structuredClone(hits);
    const borrowed = freeze(structuredClone(members));
    const requestQuery = String(query || ''), requestSource = sourceContext ? freeze(structuredClone(sourceContext)) : null;
    const identities = members.map(hit => buildRetrievalHitKey(hit, null, requestSource || {}));
    if (policyKey && (identities.some(key => !key) || new Set(identities).size !== identities.length
      || !requestSource?.generation)) throw new Error('Expanded rerank pools require unique source and selected generation identities.');
    diagnostic.resultIdentity = digest({ version: 1, adapter: adapter.identityKey ?? adapter.id,
      query: requestQuery, sourceContext: requestSource, members: identities, policyKey,
      sourceScores: members.map(hit => [hit.score ?? null, hit.scoreType ?? null, hit.sparseScore ?? null, hit.annScore ?? null]),
      finalOutputCap, maxMs, fallback, tie: 'source-rank', formatting: adapter.formattingIdentity ?? null });
    work = Promise.resolve().then(() => {
      throwIfAborted(controller.signal);
      return adapter.rerank({ query: requestQuery, hits: borrowed, signal: controller.signal, sourceContext: requestSource });
    });
    tracked = trackRerankerWork(work);
    const result = await Promise.race([work, cancellation, new Promise((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(Object.assign(new Error('Reranker deadline exceeded'), { code: 'ERR_RERANK_DEADLINE' }));
      }, maxMs);
    })]);
    throwIfAborted(signal, 'Reranker cancelled');
    if (!Array.isArray(result) || result.length !== members.length) throw new TypeError('Reranker must score each evidence member');
    const scores = new Map(), minimum = adapter.scoreRange?.min ?? -1000000, maximum = adapter.scoreRange?.max ?? 1000000;
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum > maximum) throw new TypeError('Invalid reranker score range.');
    for (const entry of result) {
      if (!entry || Object.keys(entry).some(key => key !== 'index' && key !== 'score') || !Number.isInteger(entry.index)
        || entry.index < 0 || entry.index >= members.length || scores.has(entry.index)
        || !Number.isFinite(entry.score) || entry.score < minimum || entry.score > maximum) throw new TypeError('Invalid reranker evidence scores');
      scores.set(entry.index, entry.score);
    }
    diagnostic.status = 'scored';
    const ranked = members.map((hit, index) => ({ ...hit, sourceScore: hit.score, sourceScoreType: hit.scoreType,
      score: scores.get(index), scoreType: 'model_rerank', reranker: adapter.id,
      rerankProvenance: { schemaVersion: 1, identity: diagnostic.resultIdentity, policyKey,
        generation: requestSource?.generation ?? null, sourceIdentity: identities[index], sourceRank: index + 1,
        poolCap: members.length, finalOutputCap }, __rank: index }))
      .sort((a, b) => b.score - a.score || a.__rank - b.__rank).slice(0, finalOutputCap).map(({ __rank, ...hit }) => hit);
    return attach(ranked, tracked.pending ? tracked.promise : null);
  } catch (error) {
    let classified = classifyRerankerError(error);
    error = classified.error;
    if (classified.pending) throw error;
    if (timedOut && !signal?.aborted && classified.abort) {
      error = Object.assign(new Error('Reranker deadline exceeded', { cause: error }), { code: 'ERR_RERANK_DEADLINE' });
      classified = classifyRerankerError(error);
    }
    if (signal?.aborted || classified.abort || classified.cancelled) {
      const cancellationError = signal?.aborted ? cancelled() : error;
      if (tracked?.pending) throw pendingRerankerWorkFailure(cancellationError, adapter, tracked);
      throw cancellationError;
    }
    diagnostic.status = fallback ? 'fallback' : 'failed'; diagnostic.reason = classified.reason;
    diagnostic.pending = tracked?.pending === true;
    if (!fallback) {
      if (diagnostic.pending) throw pendingRerankerWorkFailure(error, adapter, tracked);
      throw error;
    }
    return attach((members || hits).slice(0, finalOutputCap).map(hit => ({ ...hit, rerankProvenance: {
      schemaVersion: 1, identity: diagnostic.resultIdentity, policyKey, status: 'pre-rerank-fallback', reason: diagnostic.reason } })),
    diagnostic.pending ? tracked.promise : null);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
};
