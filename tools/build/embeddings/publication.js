import { writeIndexState } from './state.js';
import { throwIfAborted } from '../../../src/shared/abort.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';
import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';

/** Keep a crashed or rejected generation unavailable until manifest validation.
 * A subsequent Stage3 run can rebuild a generation left pending at any boundary.
 */
export const publishEmbeddingGeneration = async ({
  statePath, indexState, publishManifest, validate, commitReceipt, signal = null
}) => {
  throwIfAborted(signal);
  indexState.embeddings = { ...indexState.embeddings, ready: false, pending: true };
  await writeIndexState(statePath, indexState);
  await publishManifest();
  throwIfAborted(signal);
  const validation = await validate();
  throwIfAborted(signal);
  if (!validation.ok) return validation;
  await commitReceipt();
  throwIfAborted(signal);
  indexState.embeddings = { ...indexState.embeddings, ready: true, pending: false };
  await writeIndexState(statePath, indexState);
  return validation;
};

/** Terminal publication keeps original work and independent receipt/state
 * failures together. A best-effort diagnostic cannot settle another owner. */
export const publishEmbeddingFailure = async ({ primary, statePath, prepareState, runtimeReceipts, mode, writer }) => {
  let failure = primary;
  try {
    const result = await runtimeReceipts.fail(failure, mode, { writer });
    if (result !== undefined) observeStorageResource(result, { phase: 'stage3-failure-receipt-result' }).requireSettled();
  } catch (error) {
    failure = addStorageFailureContext(failure, { phase: 'stage3-failure-receipt' }, error, { secondaryPresent: true });
  }
  try {
    const state = await prepareState(failure);
    state.extensions = { ...state.extensions, runtimeAttemptId: runtimeReceipts.reference(mode),
      runtimeEmbeddingObservation: runtimeReceipts.observation(mode) };
    await writeIndexState(statePath, state);
  } catch (error) {
    failure = addStorageFailureContext(failure, { phase: 'stage3-failure-state' }, error, { secondaryPresent: true });
  }
  return failure;
};
