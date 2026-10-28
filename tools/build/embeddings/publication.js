import { writeIndexState } from './state.js';
import path from 'node:path';
import { withIndexStatePublicationLock } from '../../../src/shared/index-state-publication.js';
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
  await writeIndexState(statePath, indexState, { signal });
  await publishManifest();
  throwIfAborted(signal);
  const validation = await withIndexStatePublicationLock(path.dirname(statePath), validate, { signal });
  throwIfAborted(signal);
  if (!validation.ok) return validation;
  await commitReceipt();
  throwIfAborted(signal);
  indexState.embeddings = { ...indexState.embeddings, ready: true, pending: false };
  await writeIndexState(statePath, indexState, { signal });
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
    const attemptId = runtimeReceipts.reference(mode);
    state.extensions = { ...state.extensions, runtimeAttemptId: attemptId,
      runtimeEmbeddingObservation: runtimeReceipts.observation(mode) };
    await writeIndexState(statePath, state, { attemptId });
  } catch (error) {
    failure = addStorageFailureContext(failure, { phase: 'stage3-failure-state' }, error, { secondaryPresent: true });
  }
  return failure;
};

/** A deferred spool stays required after work settles. Close only through the
 * captured original spool after the original work observer confirms settlement.
 * Failed native close recovery remains an explicit operation on that spool. */
export const createDeferredVectorSpoolRetirement = (primary, spool) => {
  const work = observeStorageResource(observeStorageResource(primary, { phase: 'stage3-deferred-spool-work' }).retain(),
    { phase: 'stage3-deferred-spool-work' });
  const close = spool.close, observe = spool.isSettled;
  let closing = null;
  const isSettled = () => {
    try { return work.isSettled() && observe.call(spool) === true; } catch { return false; }
  };
  let owner;
  owner = Object.freeze({ isSettled, closeAfterWork() {
    if (!closing) closing = (async () => {
      work.requireSettled();
      if (observe.call(spool) !== true) await close.call(spool);
      if (!isSettled()) throw addStorageFailureContext(new Error('Original deferred vector spool remains unsettled.'), {
        vectorSpoolRetirement: owner, cacheOwnershipPending: true, cacheOwnershipReleased: isSettled
      }, undefined, { nonEnumerable: ['vectorSpoolRetirement'] });
      return Object.freeze({ settled: true, pending: false });
    })().finally(() => { closing = null; });
    return closing;
  } });
  return owner;
};
