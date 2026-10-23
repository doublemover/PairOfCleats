import { createTransformersResourceScope } from '../embedding-transformers-resources.js';
import { observeEmbeddingOwnership, preserveEmbeddingCleanupFailure } from '../embedding-cache-lifetime.js';

export const captureOnnxOutputTensors = (scope, outputs) => {
  if (!outputs || typeof outputs !== 'object') return;
  for (const value of Object.values(outputs)) {
    if (value && typeof value === 'object' && 'dispose' in value) scope.adopt(value, 'ONNX output tensor');
  }
};

/** Keep feeds, output views and pending native work under the exact session
 * owner until output decoding and every captured disposal have finished.
 */
export const withOnnxTensorScope = async (entry, invoke, retire) => {
  if (entry.operationFailure) throw entry.operationFailure;
  const scope = createTransformersResourceScope('ONNX inference tensors', { drainFailuresBeforeResources: true });
  entry.tensorScopes.add(scope);
  let result, primaryError, hasPrimary = false;
  try { result = await invoke(scope); }
  catch (error) { primaryError = error; hasPrimary = true; scope.retainFailure(error); }
  let failure = primaryError;
  try { await scope.close(); }
  catch (cleanup) { failure = hasPrimary ? preserveEmbeddingCleanupFailure(primaryError, cleanup) : cleanup; hasPrimary = true; }
  if (!scope.pending) entry.tensorScopes.delete(scope);
  const observe = observeEmbeddingOwnership(failure);
  if (observe && !observe()) {
    entry.operationFailure = failure;
    retire();
  }
  if (hasPrimary) throw failure;
  return result;
};
