import { loadEmbeddingModelComponents, resolveEmbeddingAcquisitionRoot } from './embedding-model-loading.js';
import { publishEmbeddingAcquisitionReceipt } from './embedding-acquisition-receipt.js';
import { captureTransformersResource } from './embedding-transformers-resources.js';
import { preserveEmbeddingCleanupFailure } from './embedding-cache-lifetime.js';
import { throwIfAborted } from './abort.js';

/** Actual download consumer shares the runtime loader and its cleanup owners. */
export const prefetchEmbeddingModel = async (mod, { modelId, modelsDir, modelProfile = null, signal = null }) => {
  throwIfAborted(signal);
  const acquired = await loadEmbeddingModelComponents(mod, { modelId, modelsDir, modelProfile });
  const owner = acquired.resourceOwner || captureTransformersResource(acquired.pipeline, 'downloaded embedding pipeline');
  let failure, failed = false, files = null, root = null;
  try {
    throwIfAborted(signal);
    if (modelProfile || typeof mod.ModelRegistry?.get_model_files === 'function') {
      const config = acquired.config || acquired.pipeline?.model?.config;
      if (!config) throw new Error('Selected pipeline did not expose its loaded model configuration for acquisition.');
      files = await mod.ModelRegistry.get_model_files(modelId, {
        config, dtype: acquired.plan.dtype, ...(modelProfile ? { device: 'cpu' } : {})
      });
      root = resolveEmbeddingAcquisitionRoot(modelId, modelsDir, modelProfile);
      if (!root) throw new Error('Selected model acquisition has no unambiguous local asset root.');
      throwIfAborted(signal);
    }
  } catch (error) { failed = true; failure = error; }
  try { if (acquired.resourceOwner) await owner.close(); else await owner.retire(); }
  catch (cleanup) { throw failed ? preserveEmbeddingCleanupFailure(failure, cleanup) : cleanup; }
  if (failed) throw failure;
  // Verification may read large graphs. Release the temporary native loader
  // before that I/O, and expose no new ready receipt until cleanup is confirmed.
  const receipt = files ? await publishEmbeddingAcquisitionReceipt({ root, plan: acquired.plan, files, signal }) : null;
  return { plan: acquired.plan, receipt, root };
};
