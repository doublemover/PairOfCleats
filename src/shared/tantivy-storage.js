import { acquireNativeReaderStorage } from './storage/native-reader.js';
import { observeStorageResource } from './storage/failure-observation.js';
import { addStorageFailureContext } from './storage/operation-error.js';

/** The same original resource observation gates the source lease and writer
 * lock. This never declares unknown native work settled after cancellation. */
export const withTantivyStorage = async (target, context, action) => {
  let settled = false, failure, failed = false, result;
  const owner = acquireNativeReaderStorage(target, context, () => settled);
  try {
    owner?.start();
    result = await action(); settled = true;
  } catch (error) {
    failed = true; failure = error;
    const observation = observeStorageResource(error, { phase: 'tantivy-operation' });
    settled = observation.isSettled();
    if (owner) {
      const retained = owner.retainFailure(error);
      if (!settled) failure = retained;
    }
  }
  try { owner?.releaseAfterClosure(); }
  catch (cleanup) { failure = failed ? addStorageFailureContext(failure, {}, cleanup, { secondaryPresent: true }) : cleanup; failed = true; }
  if (failed) throw failure;
  return result;
};
