import { writeIndexState } from './state.js';

/** Keep a crashed or rejected generation unavailable until manifest validation.
 * A subsequent Stage3 run can rebuild a generation left pending at any boundary.
 */
export const publishEmbeddingGeneration = async ({
  statePath, indexState, publishManifest, validate, commitReceipt
}) => {
  indexState.embeddings = { ...indexState.embeddings, ready: false, pending: true };
  await writeIndexState(statePath, indexState);
  await publishManifest();
  const validation = await validate();
  if (!validation.ok) return validation;
  await commitReceipt();
  indexState.embeddings = { ...indexState.embeddings, ready: true, pending: false };
  await writeIndexState(statePath, indexState);
  return validation;
};
