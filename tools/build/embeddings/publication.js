import { writeIndexState } from './state.js';
import { throwIfAborted } from '../../../src/shared/abort.js';

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
