import { addStorageFailureContext } from '../../../../src/shared/storage/operation-error.js';

/** Attempt every original cache owner even after one drain fails. The exact
 * primary and resource errors survive together for the outer build lifecycle. */
export const settleEmbeddingCacheConsumers = async ({ compute, reader, writer, shards, primary = null }) => {
  const failures = [];
  for (const settle of [() => compute?.drain?.(), () => reader?.drain?.(), () => writer?.onIdle?.(), () => shards?.close?.()]) {
    try { await settle(); } catch (error) { failures.push(error); }
  }
  if (failures.length) {
    const original = primary ?? failures[0];
    const additional = [...new Set(failures)].filter(error => error !== original);
    let retained = original;
    for (const error of additional) retained = addStorageFailureContext(retained, {}, error, { secondaryPresent: true });
    throw retained;
  }
};
