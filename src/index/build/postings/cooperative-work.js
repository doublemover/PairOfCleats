import { performance } from 'node:perf_hooks';
import { throwIfAborted } from '../../../shared/abort.js';

export const DEFAULT_POSTINGS_WORK_BATCH = 1024;
const MAX_ACTIVE_INTERVAL_MS = 25;

/** Drive bounded synchronous batches without allocating one Promise per row.
 * Only a real scheduler wait (or elapsed cooperative deadline) suspends work. */
export const runPostingsWork = (work, { signal = null, requestYield = null, now = () => performance.now() } = {}) => {
  let lastYieldAt = now();
  const finishFailure = error => {
    try { work.return?.(); }
    catch (cause) { throw new AggregateError([error, cause], 'Postings work failed while retiring its local iterator.', { cause: error }); }
    throw error;
  };
  const run = () => {
    try {
      for (;;) {
        throwIfAborted(signal);
        const step = work.next();
        throwIfAborted(signal);
        if (step.done) return step.value;
        let pending = requestYield?.(step.value) || null;
        if (!pending && now() - lastYieldAt >= MAX_ACTIVE_INTERVAL_MS) {
          pending = new Promise(resolve => setImmediate(resolve));
        }
        if (pending) {
          return Promise.resolve(pending).then(() => { lastYieldAt = now(); return run(); }, finishFailure);
        }
      }
    } catch (error) { return finishFailure(error); }
  };
  return run();
};

/** Stable bounded sorted runs and merging; callers retain their array owner. */
export function* sortPostingsWork(values, compare, batchSize = DEFAULT_POSTINGS_WORK_BATCH, phase = 'sort') {
  if (values.length <= batchSize) { values.sort(compare); return values; }
  for (let start = 0; start < values.length; start += batchSize) {
    const end = Math.min(values.length, start + batchSize);
    const run = values.slice(start, end); run.sort(compare);
    for (let index = start; index < end; index++) values[index] = run[index - start];
    yield { phase, units: end - start };
  }
  let source = values, target = new Array(values.length);
  for (let width = batchSize; width < values.length; width *= 2) {
    let units = 0;
    for (let start = 0; start < values.length; start += width * 2) {
      const middle = Math.min(values.length, start + width), end = Math.min(values.length, start + width * 2);
      let left = start, right = middle;
      for (let index = start; index < end; index++) {
        target[index] = right >= end || (left < middle && compare(source[left], source[right]) <= 0)
          ? source[left++] : source[right++];
        if (++units === batchSize) { yield { phase, units }; units = 0; }
      }
    }
    if (units) yield { phase, units };
    [source, target] = [target, source];
  }
  if (source !== values) {
    for (let index = 0; index < source.length; index++) {
      values[index] = source[index];
      if ((index + 1) % batchSize === 0) yield { phase, units: batchSize };
    }
  }
  return values;
}

/** Preserve the legacy sorted-input fast path, including equal-ID order. */
export function* normalizeTfPostingsWork(value, batchSize = DEFAULT_POSTINGS_WORK_BATCH) {
  if (!Array.isArray(value)) return [];
  const result = [];
  let ordered = true, previous = -Infinity;
  for (let index = 0; index < value.length; index++) {
    const entry = value[index];
    if (Array.isArray(entry)) {
      const docId = entry[0], count = entry[1];
      if (Number.isFinite(docId) && Number.isFinite(count)) {
        if (docId < previous) ordered = false;
        previous = docId; result.push([docId, Math.trunc(count)]);
      }
    }
    if ((index + 1) % batchSize === 0) yield { phase: 'posting-copy', units: batchSize };
  }
  if (value.length % batchSize) yield { phase: 'posting-copy', units: value.length % batchSize };
  if (!ordered) yield* sortPostingsWork(result, (left, right) => left[0] - right[0] || left[1] - right[1], batchSize, 'posting-sort');
  return result;
}
