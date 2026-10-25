import { addStorageFailureContext } from './storage/operation-error.js';

const receipts = new WeakMap();
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

/** Passive producer bookkeeping. Serialized lookalikes convey no attestation
 * and this identity receipt grants no cleanup, mutation or execution authority. */
export const createRuntimeClaimPublicationState = () => {
  const state = {};
  return {
    state,
    retainFailure(error) {
      const prior = receipts.get(error);
      const receipt = prior || (hash(state.claimGeneration) && hash(state.manifestHash)
        && ['promotion-unconfirmed', 'promoted', 'reused'].includes(state.familyState)
        && ['not-started', 'commit-unconfirmed', 'committed'].includes(state.pointerState)
        ? Object.freeze({ schemaVersion: 1, claimGeneration: state.claimGeneration, manifestHash: state.manifestHash,
          familyState: state.familyState, pointerState: state.pointerState }) : null);
      if (!receipt) return error;
      const failure = addStorageFailureContext(error, { runtimeClaimPublication: receipt });
      receipts.set(failure, receipt);
      return failure;
    }
  };
};

export const getRuntimeClaimPublication = error => receipts.get(error) || null;
