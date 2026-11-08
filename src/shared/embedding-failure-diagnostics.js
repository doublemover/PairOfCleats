import { captureEmbeddingCacheFailure, projectEmbeddingCacheFailure } from './embedding-cache-failure-inspection.js';
import { observeEmbeddingOwnership } from './embedding-cache-lifetime.js';

export const captureEmbeddingFailureDiagnostics = error => captureEmbeddingCacheFailure(error, observeEmbeddingOwnership);

/** Project captured descriptors through a plain intermediate object, so each
 * actual resource producer can reserve its own unforgeable owner fields. */
export const projectEmbeddingFailureDiagnostics = (target, captured, reserved = []) => {
  const projection = {}, excluded = new Set(reserved);
  projectEmbeddingCacheFailure(projection, captured);
  for (const key of Reflect.ownKeys(projection)) if (!excluded.has(key)) {
    Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(projection, key));
  }
};
