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
  const measurements = entry.measurements;
  if (measurements) measurements.peakRetainedTensorScopes = Math.max(measurements.peakRetainedTensorScopes || 0, entry.tensorScopes.size);
  let result, primaryError, hasPrimary = false;
  try { result = await invoke(scope); }
  catch (error) { primaryError = error; hasPrimary = true; scope.retainFailure(error); }
  let failure = primaryError;
  const cleanupStarted = performance.now(), resources = scope.resources;
  let cleanupFailed = false;
  try { await scope.close(); }
  catch (cleanup) { cleanupFailed = true; failure = hasPrimary ? preserveEmbeddingCleanupFailure(primaryError, cleanup) : cleanup; hasPrimary = true; }
  if (measurements) {
    measurements.tensorCleanupWallMs = (measurements.tensorCleanupWallMs || 0) + performance.now() - cleanupStarted;
    measurements.tensorResourcesObserved = (measurements.tensorResourcesObserved || 0) + resources.length;
    measurements.tensorResourcesSettled = (measurements.tensorResourcesSettled || 0) + resources.filter(owner => !owner.pending).length;
    measurements.tensorCleanupFailures = (measurements.tensorCleanupFailures || 0) + (cleanupFailed ? 1 : 0);
  }
  if (!scope.pending) entry.tensorScopes.delete(scope);
  const observe = observeEmbeddingOwnership(failure);
  if (observe && !observe()) {
    entry.operationFailure = failure;
    retire();
  }
  if (hasPrimary) throw failure;
  return result;
};
