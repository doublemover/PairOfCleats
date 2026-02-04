// Ordered appender used to ensure deterministic chunk/doc ids regardless of
// concurrency and shard execution order.
//
// IMPORTANT: The original implementation returned the *flush attempt* promise.
// When an earlier file was slow, results from later files accumulated in
// `pending` until `nextIndex` advanced, creating unbounded buffering and
// eventual V8 OOMs that were highly timing-sensitive (e.g., "--inspect" would
// often avoid the crash).
//
// This version returns a promise that resolves only once the specific
// `orderIndex` has been flushed (i.e., processed in order). That creates
// backpressure via `runWithQueue`'s awaited `onResult`, bounding in-flight
// buffered results to queue concurrency.
export const buildOrderedAppender = (handleFileResult, state) => {
  const pending = new Map();
  let nextIndex = 0;
  let flushing = null;
  let aborted = false;
  const skipped = new Set();

  const advancePastSkipped = () => {
    while (skipped.has(nextIndex)) {
      skipped.delete(nextIndex);
      nextIndex += 1;
    }
  };

  const abort = (err) => {
    if (aborted) return;
    aborted = true;
    for (const entry of pending.values()) {
      try {
        entry?.reject?.(err);
      } catch {}
    }
    pending.clear();
  };

  const flush = async () => {
    advancePastSkipped();
    while (pending.has(nextIndex)) {
      const entry = pending.get(nextIndex);
      pending.delete(nextIndex);
      try {
        if (entry?.result) {
          await handleFileResult(entry.result, state, entry.shardMeta);
        }
        entry?.resolve?.();
      } catch (err) {
        try { entry?.reject?.(err); } catch {}
        throw err;
      } finally {
        nextIndex += 1;
        advancePastSkipped();
      }
    }
  };

  const scheduleFlush = async () => {
    if (flushing) return flushing;
    flushing = (async () => {
      try {
        await flush();
      } catch (err) {
        abort(err);
        throw err;
      } finally {
        flushing = null;
      }
    })();
    return flushing;
  };

  return {
    enqueue(orderIndex, result, shardMeta) {
      if (aborted) {
        return Promise.reject(new Error('Ordered appender aborted.'));
      }
      if (Number.isFinite(orderIndex) && orderIndex < nextIndex) {
        return handleFileResult(result, state, shardMeta);
      }
      const index = Number.isFinite(orderIndex) ? orderIndex : nextIndex;
      let resolve;
      let reject;
      const done = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });
      pending.set(index, { result, shardMeta, resolve, reject });
      // Ensure rejections from the flush loop don't surface as unhandled.
      scheduleFlush().catch(() => {});
      return done;
    },
    skip(orderIndex) {
      if (aborted) return Promise.reject(new Error('Ordered appender aborted.'));
      const index = Number.isFinite(orderIndex) ? orderIndex : nextIndex;
      if (index < nextIndex) return Promise.resolve();
      skipped.add(index);
      // Ensure we advance if the skipped index is next up.
      scheduleFlush().catch(() => {});
      return Promise.resolve();
    },
    abort
  };
};
