import { historyError } from './common.js';

/** Bound host callbacks even when they neglect cooperative cancellation. */
export async function runHistoryCallback(callback, signal) {
  signal.throwIfAborted();
  let onAbort;
  const cancelled = new Promise((_, reject) => {
    onAbort = () => reject(historyError('ERR_INFERENCE_HISTORY_LIMIT', 'Local retrieval time limit exceeded.'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try { return await Promise.race([Promise.resolve().then(callback), cancelled]); }
  finally { signal.removeEventListener('abort', onAbort); }
}
