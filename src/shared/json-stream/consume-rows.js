import { throwIfAborted } from './runtime.js';
import { addStorageFailureContext } from '../storage/operation-error.js';

/** Consume one yield before advancing either iterator protocol. The producer
 * may reuse yielded storage on its next advance. Unexpected next()/value/work
 * failures still close the captured iterator, preserving independent cleanup.
 */
export const consumeJsonRows = async (items, consume, { signal = null, awaitSyncValues = false, syncOnly = false } = {}) => {
  throwIfAborted(signal);
  const asyncMethod = syncOnly ? null : items?.[Symbol.asyncIterator];
  const method = asyncMethod == null ? items?.[Symbol.iterator] : asyncMethod;
  if (typeof method !== 'function') throw new TypeError(syncOnly
    ? 'JSON output requires a synchronous iterable.' : 'JSON output requires a synchronous or asynchronous iterable.');
  const iterator = method.call(items);
  if (iterator === null || !['object', 'function'].includes(typeof iterator)) throw new TypeError('JSON iterator is not an object.');
  let completed = false, failed = false, primary;
  try {
    const nextMethod = iterator.next;
    if (typeof nextMethod !== 'function') throw new TypeError('JSON iterator next() is not callable.');
    const next = nextMethod.bind(iterator);
    while (true) {
      throwIfAborted(signal);
      const entry = typeof asyncMethod === 'function' ? await next() : next();
      if (entry === null || !['object', 'function'].includes(typeof entry)) throw new TypeError('JSON iterator next() returned a non-object result.');
      if (entry.done) { completed = true; break; }
      const row = typeof asyncMethod !== 'function' && awaitSyncValues ? await entry.value : entry.value;
      throwIfAborted(signal);
      await consume(row);
    }
  } catch (error) { failed = true; primary = error; }
  if (!completed) {
    try {
      const close = iterator.return;
      if (close != null) {
        if (typeof close !== 'function') throw new TypeError('JSON iterator return() is not callable.');
        const result = await close.call(iterator);
        if (result === null || !['object', 'function'].includes(typeof result)) throw new TypeError('JSON iterator return() returned a non-object result.');
      }
    } catch (error) {
      primary = failed ? addStorageFailureContext(primary, {}, error, { secondaryPresent: true }) : error;
      failed = true;
    }
  }
  if (failed) throw primary;
};
