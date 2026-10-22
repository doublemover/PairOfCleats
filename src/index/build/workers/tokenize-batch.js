import { serialize } from 'node:v8';
import { throwIfAborted, isAbortError } from '../../../shared/abort.js';

export const TOKENIZE_BATCH_MAX_CHUNKS = 8;
export const TOKENIZE_BATCH_MAX_TEXT_BYTES = 128 * 1024;
export const TOKENIZE_BATCH_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const budgetError = () => Object.assign(new Error('Token batch exceeds its bounded protocol allowance.'), { code: 'ERR_TOKENIZE_BATCH_BUDGET' });
const samePolicy = (left, right) => ['mode', 'ext', 'languageId'].every(key => left?.[key] === right?.[key])
  && (left?.dictConfig?.segmentation ?? null) === (right?.dictConfig?.segmentation ?? null)
  && (left?.dictConfig?.dpMaxTokenLength ?? null) === (right?.dictConfig?.dpMaxTokenLength ?? null);
const sameInput = (left, right) => samePolicy(left, right) && left.text === right.text;
export const validateTokenizeBatch = payload => {
  const items = payload?.items;
  if (!Array.isArray(items) || !items.length || items.length > TOKENIZE_BATCH_MAX_CHUNKS) throw budgetError();
  let bytes = 0;
  for (const item of items) {
    if (!item || ['mode', 'ext', 'languageId'].some(key => item[key] != null && (typeof item[key] !== 'string' || item[key].length > 128))
      || (item.dictConfig?.segmentation != null && (typeof item.dictConfig.segmentation !== 'string' || item.dictConfig.segmentation.length > 128))
      || (item.dictConfig?.dpMaxTokenLength != null && !Number.isFinite(Number(item.dictConfig.dpMaxTokenLength)))
      || typeof item?.text !== 'string' || item.text.length > TOKENIZE_BATCH_MAX_TEXT_BYTES || !samePolicy(items[0], item)) throw budgetError();
    bytes += Buffer.byteLength(item.text);
    if (bytes > TOKENIZE_BATCH_MAX_TEXT_BYTES) throw budgetError();
  }
  return { items, bytes };
};

/** Scratch belongs to the existing single-task worker; each result owns its output arrays. */
export const executeTokenizeBatch = (payload, tokenize) => {
  const { items, bytes } = validateTokenizeBatch(payload);
  const results = [];
  let outputBytes = 0;
  for (const item of items) {
    let result;
    try { result = { ok: true, value: tokenize(item) }; }
    catch (error) {
      if (isAbortError(error)) throw error;
      result = { ok: false, error: { name: String(error?.name || 'Error').slice(0, 128),
        message: String(error?.message || error).slice(0, 2048), code: typeof error?.code === 'string' ? error.code.slice(0, 128) : null } };
    }
    outputBytes += serialize(result).length;
    if (outputBytes > TOKENIZE_BATCH_MAX_OUTPUT_BYTES) throw budgetError();
    results.push(result);
  }
  return { results, inputBytes: bytes, outputBytes };
};
const unwrap = result => {
  if (result === null) return null;
  if (result?.ok === true) return result.value;
  if (result?.ok !== false || !result.error || typeof result.error.message !== 'string') throw budgetError();
  const error = new Error(result.error.message);
  error.name = result.error.name || 'Error';
  if (result.error.code) error.code = result.error.code;
  throw error;
};

/** One awaited batch per file; no concurrent per-chunk promise flood or transferred source buffers. */
export const createOrderedTokenizeBatchWindow = ({ runBatch, runSingle, getInput, count, signal = null,
  canDispatch = () => true, metrics = {} }) => {
  const ready = new Map();
  return {
    async take(index, input) {
      throwIfAborted(signal);
      const prior = ready.get(index);
      if (prior) {
        ready.delete(index);
        metrics.retainedChunks = ready.size;
        if (sameInput(prior.input, input)) return unwrap(prior.result);
        ready.clear(); metrics.retainedChunks = 0; // A changed transform cannot borrow earlier text.
      }
      if (!canDispatch()) return null;
      const items = [input];
      let bytes = Buffer.byteLength(input.text);
      if (input.text.length > TOKENIZE_BATCH_MAX_TEXT_BYTES || bytes > TOKENIZE_BATCH_MAX_TEXT_BYTES) {
        metrics.singleTasks = (metrics.singleTasks || 0) + 1; return runSingle(input);
      }
      for (let next = index + 1; next < count && items.length < TOKENIZE_BATCH_MAX_CHUNKS; next += 1) {
        throwIfAborted(signal);
        const item = getInput(next);
        if (!item || !samePolicy(input, item) || typeof item.text !== 'string' || item.text.length > TOKENIZE_BATCH_MAX_TEXT_BYTES) break;
        const itemBytes = Buffer.byteLength(item.text);
        if (bytes + itemBytes > TOKENIZE_BATCH_MAX_TEXT_BYTES) break;
        bytes += itemBytes; items.push(item);
      }
      if (items.length < 2) { metrics.singleTasks = (metrics.singleTasks || 0) + 1; return runSingle(input); }
      metrics.batchTasks = (metrics.batchTasks || 0) + 1;
      metrics.serializedTextBytes = (metrics.serializedTextBytes || 0) + bytes;
      metrics.chunksSubmitted = (metrics.chunksSubmitted || 0) + items.length;
      metrics.batchChunksHighWater = Math.max(metrics.batchChunksHighWater || 0, items.length);
      metrics.batchTextBytesHighWater = Math.max(metrics.batchTextBytesHighWater || 0, bytes);
      const batch = await runBatch({ items });
      throwIfAborted(signal);
      if (batch !== null && (!Array.isArray(batch?.results) || batch.results.length !== items.length
        || !Number.isSafeInteger(batch.outputBytes) || batch.outputBytes < 0 || batch.outputBytes > TOKENIZE_BATCH_MAX_OUTPUT_BYTES)) throw budgetError();
      const results = batch?.results || items.map(() => null);
      for (let offset = 1; offset < items.length; offset += 1) ready.set(index + offset, { input: items[offset], result: results[offset] });
      metrics.retainedChunks = ready.size;
      metrics.retainedChunksHighWater = Math.max(metrics.retainedChunksHighWater || 0, ready.size);
      metrics.outputBytes = (metrics.outputBytes || 0) + (batch?.outputBytes || 0);
      return unwrap(results[0]);
    }
  };
};
