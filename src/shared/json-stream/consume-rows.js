import { throwIfAborted } from './runtime.js';
import { addStorageFailureContext } from '../storage/operation-error.js';

/** Consume one yield before advancing either iterator protocol. The producer
 * may reuse yielded storage on its next advance. Unexpected next()/value/work
 * failures still close the captured iterator, preserving independent cleanup.
 */
export const consumeJsonRows = async (items, consume, { signal = null, awaitSyncValues = false } = {}) => {
  throwIfAborted(signal);
  const asyncMethod = items?.[Symbol.asyncIterator];
  const iterator = typeof asyncMethod === 'function' ? asyncMethod.call(items) : items?.[Symbol.iterator]?.();
  if (!iterator || typeof iterator.next !== 'function') throw new TypeError('JSON output requires a synchronous or asynchronous iterable.');
  const next = iterator.next.bind(iterator);
  let completed = false, failed = false, primary;
  try {
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
