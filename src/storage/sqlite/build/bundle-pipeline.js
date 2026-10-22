import { composeAbortSignals, throwIfAborted, raceAbort } from '../../../shared/abort.js';
const retainedFailedWindows = new Set();

/** Ordered single-consumer window. Credits survive decode completion until the
 * consumer releases a shard. No full-file shard arrays or batch barriers. */
export async function* orderedBundleShardWindow({ source, load, concurrency, maxBytes, signal = null,
  close = null, metrics = {} }) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError('Ordered bundle decoding requires positive bounded count/byte admission.');
  }
  const controller = new AbortController(), operationSignal = composeAbortSignals(signal, controller.signal);
  const iterator = source[Symbol.asyncIterator] ? source[Symbol.asyncIterator]() : source[Symbol.iterator]();
  const pending = []; let lookahead = null, exhausted = false, reserved = 0, primary = null;
  Object.assign(metrics, { peakReservedBytes: 0, peakPendingShards: 0, decodedShards: 0,
    encodedBytes: 0, projectionBytes: 0, oversizeSingleShards: 0, currentReservedBytes: 0 });
  const fill = async () => {
    while (!exhausted && pending.length < concurrency) {
      throwIfAborted(operationSignal);
      if (!lookahead) {
        const next = await iterator.next();
        if (next.done) { exhausted = true; break; }
        lookahead = next.value;
      }
      const charge = lookahead.reservedBytes;
      if (!Number.isSafeInteger(charge) || charge < 1) throw new TypeError('Bundle shard needs a bounded byte reservation.');
      if (reserved > 0 && reserved + charge > maxBytes) break;
      if (charge > maxBytes) metrics.oversizeSingleShards++;
      const task = lookahead; lookahead = null;
      reserved += charge; metrics.currentReservedBytes = reserved;
      metrics.peakReservedBytes = Math.max(metrics.peakReservedBytes, reserved);
      const result = Promise.resolve().then(() => load(task, operationSignal));
      result.catch(() => {}); pending.push({ task, charge, result });
      metrics.peakPendingShards = Math.max(metrics.peakPendingShards, pending.length);
    }
  };
  try {
    await fill();
    while (pending.length) {
      throwIfAborted(operationSignal);
      const current = pending[0];
      let result = await raceAbort(operationSignal, current.result);
      throwIfAborted(operationSignal);
      metrics.decodedShards++;
      metrics.encodedBytes += Number(result.encodedBytes) || 0;
      metrics.projectionBytes += Number(result.projectionBytes) || 0;
      yield result;
      // Insertion completed before credits return; a later failure still rolls
      // back the enclosing SQLite transaction before any database publication.
      result = null; reserved -= current.charge; pending.shift(); metrics.currentReservedBytes = reserved;
      await fill();
    }
  } catch (error) { primary = error; throw error; }
  finally {
    controller.abort();
    let cleanup = null;
    try { await close?.(); } catch (error) { cleanup = error; }
    await Promise.allSettled(pending.map(item => item.result));
    try { await iterator.return?.(); } catch (error) { cleanup ||= error; }
    if (cleanup) {
      metrics.retainedOnTeardownFailureBytes = reserved;
      retainedFailedWindows.add({ pending, reserved, error: cleanup });
    } else { pending.length = 0; reserved = 0; metrics.currentReservedBytes = 0; }
    if (cleanup) {
      if (primary) { try { primary.bundlePipelineTeardownError = cleanup; } catch {} }
      else throw cleanup;
    }
  }
}
