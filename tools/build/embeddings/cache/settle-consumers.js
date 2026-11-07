import { addStorageFailureContext } from '../../../../src/shared/storage/operation-error.js';

/** Attempt every original cache owner even after one drain fails. The exact
 * primary and resource errors survive together for the outer build lifecycle. */
export const settleEmbeddingCacheConsumers = async ({ compute, reader, writer, shards, primary,
  primaryPresent = primary !== null && primary !== undefined }) => {
  const failures = [];
  for (const settle of [() => compute?.drain?.(), () => reader?.drain?.(), () => writer?.onIdle?.(), () => shards?.close?.()]) {
    try { await settle(); } catch (error) { failures.push(error); }
  }
  if (failures.length) {
    const original = primaryPresent ? primary : failures[0];
    const additional = [...new Set(failures)].filter(error => error !== original);
    if (!additional.length) throw original;
    // Compose cleanup observations together before attaching them once to the
    // original work failure. The immediate cause remains the actual primary.
    let cleanup = additional[0];
    for (const error of additional.slice(1)) cleanup = addStorageFailureContext(cleanup, {}, error, { secondaryPresent: true });
    throw addStorageFailureContext(original, {}, cleanup, { secondaryPresent: true });
  }
};
