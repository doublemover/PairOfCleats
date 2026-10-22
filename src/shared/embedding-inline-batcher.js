import { createAbortError, throwIfAborted } from './abort.js';
import { assertVectorArrays } from './embedding-batches.js';
import { planEmbeddingBatches } from './embedding-batch-plan.js';

const batchers = new WeakMap();
const closedError = () => Object.assign(new Error('Inline embedding batch owner is closed.'), { code: 'ERR_EMBEDDING_RUNTIME_CLOSED' });

/** Runtime-owned admission, exact-text dedup and token planning; one provider call
 * at a time respects every adapter's maxConcurrentInference capability. */
export const createInlineEmbeddingBatcher = (embed, { maxQueuedItems = 4096, maxQueuedBytes = 16 * 1024 * 1024 } = {}) => {
  const entries = new Map(), requests = new Set();
  let pendingItems = 0, pendingBytes = 0, scheduled = null, running = null, closed = false, observedDims = null;
  const finishRequest = request => {
    if (request.remaining) return;
    request.signal?.removeEventListener('abort', request.onAbort);
    requests.delete(request); pendingItems -= request.count; pendingBytes -= request.bytes;
    if (!request.cancelled) request.resolve(request.outputs);
  };
  const cancelRequest = (request, error) => {
    if (request.cancelled) return;
    request.cancelled = true; request.outputs = null; request.reject(error);
    request.signal?.removeEventListener('abort', request.onAbort);
    for (const [entry, slots] of request.pending) {
      const batch = entry.batch;
      if (!batch) {
        entry.waiters.delete(request); request.pending.delete(entry); request.remaining -= slots.length;
        if (!entry.waiters.size && entries.get(entry.text) === entry) entries.delete(entry.text);
      } else if (!batch.started && batch.entries.every(item => [...item.waiters.keys()].every(owner => owner.cancelled))) {
        batch.controller.abort();
      }
    }
    finishRequest(request);
  };
  const settleEntry = (entry, vector, error = null) => {
    if (entries.get(entry.text) === entry) entries.delete(entry.text);
    entry.batch = null;
    for (const [request, slots] of entry.waiters) {
      request.pending.delete(entry); request.remaining -= slots.length;
      if (error) cancelRequest(request, error);
      else if (!request.cancelled) {
        const bytes = (vector.byteLength || vector.length * 8) * slots.length;
        if (pendingBytes + bytes > maxQueuedBytes) cancelRequest(request, new RangeError('Inline embedding results exceed admitted byte budget.'));
        else {
          request.bytes += bytes; pendingBytes += bytes;
          for (const slot of slots) request.outputs[slot] = vector;
        }
      }
      if (requests.has(request)) finishRequest(request);
    }
    entry.waiters.clear();
  };
  const flush = () => {
    if (running) return running;
    running = (async () => {
      while (entries.size && !closed) {
        const snapshot = [...entries.values()].filter(entry => !entry.batch && entry.waiters.size);
        if (!snapshot.length) break;
        let tokenEstimates = null;
        try {
          if (typeof embed.estimateTokensBatch === 'function') tokenEstimates = await embed.estimateTokensBatch(snapshot.map(entry => entry.text));
          const estimates = snapshot.map((entry, index) => Math.max(1, Math.floor(Number(tokenEstimates?.[index]) || Math.ceil(entry.text.length / 4))));
          const owners = [...new Set(snapshot.flatMap(entry => [...entry.waiters.keys()]))].filter(request => !request.cancelled);
          if (!owners.length) continue;
          const maxItems = Math.min(1024, ...owners.map(request => request.batchSize));
          const positiveBudgets = owners.map(request => request.tokenBudget).filter(value => value > 0);
          const tokenBudget = positiveBudgets.length ? Math.min(...positiveBudgets) : 0;
          const plan = planEmbeddingBatches({ estimates, maxItems, tokenBudget });
          for (const indices of plan.batches) {
            const live = indices.map(index => snapshot[index]).filter(entry => entries.get(entry.text) === entry && entry.waiters.size);
            if (!live.length) continue;
            const batch = { entries: live, controller: new AbortController(), started: false };
            for (const entry of live) entry.batch = batch;
            const owner = [...live[0].waiters.keys()].find(request => !request.cancelled);
            try {
              const vectors = await owner.run(async () => {
                throwIfAborted(batch.controller.signal); batch.started = true;
                return embed(live.map(entry => entry.text));
              }, { signal: batch.controller.signal });
              assertVectorArrays(vectors, live.length, 'inline shared batch');
              if (observedDims !== null && vectors[0].length !== observedDims) throw new Error('[embeddings] Inline shared embedding dimensions changed between batches.');
              observedDims = vectors[0].length;
              live.forEach((entry, index) => settleEntry(entry, vectors[index]));
            } catch (error) { for (const entry of live) settleEntry(entry, null, error); }
          }
        } catch (error) {
          for (const entry of snapshot) if (entries.get(entry.text) === entry) settleEntry(entry, null, error);
        } finally { tokenEstimates?.release?.(); }
      }
    })().finally(() => { running = null; if (entries.size && !closed) schedule(); });
    return running;
  };
  const schedule = () => {
    if (scheduled || running || closed) return;
    scheduled = setImmediate(() => {
      scheduled = null;
      flush().catch(error => { for (const request of [...requests]) cancelRequest(request, error); });
    });
  };
  const request = async (texts, { signal = null, batchSize = 32, tokenBudget = 8192, run = fn => fn() } = {}) => {
    if (closed) return Promise.reject(closedError());
    throwIfAborted(signal);
    if (!Array.isArray(texts) || texts.some(text => typeof text !== 'string')) return Promise.reject(new TypeError('Inline embeddings require string payloads.'));
    if (!texts.length) return Promise.resolve([]);
    const bytes = texts.reduce((sum, text) => sum + text.length * 2 + 128, 0);
    if (pendingItems + texts.length > maxQueuedItems || pendingBytes + bytes > maxQueuedBytes) return Promise.reject(new RangeError('Inline embedding queue exceeds item/byte admission.'));
    return new Promise((resolve, reject) => {
      const owner = { resolve, reject, signal, run, count: texts.length, bytes, remaining: texts.length, cancelled: false,
        batchSize: Number.isFinite(Number(batchSize)) && Number(batchSize) > 0 ? Math.max(1, Math.floor(Number(batchSize))) : 32,
        tokenBudget: Number.isFinite(Number(tokenBudget)) && Number(tokenBudget) >= 0 ? Math.floor(Number(tokenBudget)) : 8192,
        pending: new Map(), outputs: new Array(texts.length), onAbort: null };
      requests.add(owner); pendingItems += texts.length; pendingBytes += bytes;
      texts.forEach((text, index) => {
        let entry = entries.get(text);
        if (entry?.batch?.controller.signal.aborted) entry = null;
        if (!entry) { entry = { text, waiters: new Map(), batch: null }; entries.set(text, entry); }
        let slots = entry.waiters.get(owner);
        if (!slots) { slots = []; entry.waiters.set(owner, slots); owner.pending.set(entry, slots); }
        slots.push(index);
      });
      owner.onAbort = () => cancelRequest(owner, createAbortError());
      signal?.addEventListener('abort', owner.onAbort, { once: true });
      if (signal?.aborted) owner.onAbort();
      schedule();
    });
  };
  const close = async () => {
    closed = true;
    if (scheduled) { clearImmediate(scheduled); scheduled = null; }
    for (const owner of [...requests]) cancelRequest(owner, closedError());
    if (running) await running;
  };
  return { request, close, stats: () => ({ pendingItems, pendingBytes, requests: requests.size, uniqueTexts: entries.size, closed }) };
};

export const getInlineEmbeddingBatcher = embed => {
  let batcher = batchers.get(embed);
  if (!batcher) { batcher = createInlineEmbeddingBatcher(embed); batchers.set(embed, batcher); }
  return batcher;
};
export const closeInlineEmbeddingBatcher = async embed => { await batchers.get(embed)?.close(); };
