import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';

/** Consume the actual pool receipt without inventing resource settlement or
 * replacing an original denial with only benchmark status/count diagnostics. */
export const assertPartialLspDrain = (drain, fixtureRoot) => {
  if (drain?.status === 'ok') return drain;
  const fields = { code: 'ERR_BENCH_LSP_DRAIN', drain, fixtureRoot };
  const failures = Array.isArray(drain?.failures) ? drain.failures : [];
  if (!failures.length) throw Object.assign(new Error('LSP benchmark pool drain is unconfirmed; fixture retained.'), fields);
  let error = addStorageFailureContext(failures[0], fields, null, { forceAggregate: true });
  for (const failure of failures.slice(1)) error = addStorageFailureContext(error, {}, failure, { secondaryPresent: true });
  throw error;
};
