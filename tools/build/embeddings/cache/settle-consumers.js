/** Attempt every original cache owner even after one drain fails. The exact
 * primary and resource errors survive together for the outer build lifecycle. */
export const settleEmbeddingCacheConsumers = async ({ compute, reader, writer, shards, primary = null }) => {
  const failures = [];
  for (const settle of [() => compute?.drain?.(), () => reader?.drain?.(), () => writer?.onIdle?.(), () => shards?.close?.()]) {
    try { await settle(); } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError([...(primary ? [primary] : []), ...failures],
    'Embedding cache consumers failed to settle.', { cause: primary || failures[0] });
};
