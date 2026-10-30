import path from 'node:path';
import { isEmbeddingModelRepositoryId, resolveEmbeddingArtifactRoot } from './embedding-artifact-identity.js';
import { bindTransformersResourceProducer, createTransformersResourceScope } from './embedding-transformers-resources.js';
import { preserveEmbeddingCleanupFailure } from './embedding-cache-lifetime.js';
import { resolveEmbeddingAcquisitionPlan } from './embedding-acquisition-plan.js';
import { snapshotEmbeddingMetadata } from './embedding-selection-snapshot.js';

export { EMBEDDING_ACQUISITION_RECEIPT } from './embedding-acquisition-receipt.js';

export { resolveEmbeddingAcquisitionPlan } from './embedding-acquisition-plan.js';

export const resolveEmbeddingAcquisitionRoot = (modelId, modelsDir, profile = null) => {
  const root = resolveEmbeddingArtifactRoot(modelId, modelsDir);
  return root && profile?.revision && isEmbeddingModelRepositoryId(modelId) ? path.join(root, profile.revision) : root;
};

const loadTextFeatureExtractionPipeline = async (mod, modelId, options) => {
  const { AutoTokenizer, AutoModel, FeatureExtractionPipeline } = mod;
  const componentApis = [AutoTokenizer?.from_pretrained, AutoModel?.from_pretrained, FeatureExtractionPipeline];
  // Factory-only injected modules retain their existing test seam. A versioned
  // runtime or partial component surface must never hide a missing export.
  if (mod.env?.version == null && AutoTokenizer == null && AutoModel == null && FeatureExtractionPipeline == null) {
    return { pipeline: await mod.pipeline('feature-extraction', modelId, options) };
  }
  if (!componentApis.every(value => typeof value === 'function')) {
    throw new Error('Text embeddings require AutoTokenizer, AutoModel and FeatureExtractionPipeline.');
  }
  // Transformers.js 4.3.2 factory file discovery drops cache_dir and
  // local_files_only before deciding whether to load a tokenizer. Construct
  // the required text components directly with the same selected model policy.
  const resourceOwner = createTransformersResourceScope('embedding feature-extraction components', { drainFailuresBeforeResources: true });
  try {
    const tokenizer = resourceOwner.adopt(await AutoTokenizer.from_pretrained(modelId, options), 'embedding tokenizer');
    if (typeof tokenizer !== 'function') throw new TypeError('Embedding tokenizer must be callable.');
    const model = resourceOwner.adopt(await AutoModel.from_pretrained(modelId, options), 'embedding text model');
    if (typeof model !== 'function') throw new TypeError('Embedding text model must be callable.');
    const pipeline = new FeatureExtractionPipeline({ task: 'feature-extraction', tokenizer, model });
    if (typeof pipeline !== 'function') throw new TypeError('Embedding feature-extraction pipeline must be callable.');
    // Upstream Pipeline.dispose only calls model.dispose. Capture both original
    // components through the shared owner, including partial startup failures.
    let disposeRequested = false;
    pipeline.dispose = () => {
      const retry = disposeRequested; disposeRequested = true;
      return resourceOwner.close({ retry });
    };
    bindTransformersResourceProducer(pipeline, resourceOwner);
    return { pipeline, resourceOwner };
  } catch (error) {
    resourceOwner.retainFailure(error);
    try { await resourceOwner.close(); } catch (cleanup) { throw preserveEmbeddingCleanupFailure(error, cleanup); }
    throw error;
  }
};

/** Load only the qualified text components; callers own returned resources. */
export const loadEmbeddingModelComponents = async (mod, {
  modelId, modelsDir, modelProfile = null, localFilesOnly = false,
  sessionOptions = {}, modelFileName = null
}) => {
  modelProfile = snapshotEmbeddingMetadata(modelProfile);
  sessionOptions = snapshotEmbeddingMetadata(sessionOptions);
  const plan = resolveEmbeddingAcquisitionPlan(modelId, modelProfile);
  const options = {
    ...(localFilesOnly ? { local_files_only: true } : {}),
    ...(modelsDir ? { cache_dir: modelsDir } : {}),
    ...(plan.revision ? { revision: plan.revision } : {})
  };
  if (!modelProfile) {
    return { plan, ...await loadTextFeatureExtractionPipeline(mod, modelId, { dtype: plan.dtype, ...options,
      ...(Object.keys(sessionOptions).length ? { session_options: sessionOptions } : {}) }) };
  }
  const { AutoConfig, AutoTokenizer, AutoModel } = mod;
  if (!mod.EmbeddingGemma2Model || !AutoConfig || !AutoTokenizer || !AutoModel
    || `transformers.js@${mod.env?.version}` !== plan.runtime) {
    throw new Error('EmbeddingGemma 2 requires its qualified Transformers.js runtime.');
  }
  const config = await AutoConfig.from_pretrained(modelId, options);
  if (config.model_type !== 'embedding_gemma2') {
    throw new Error('EmbeddingGemma 2 model configuration has an unexpected model_type.');
  }
  config.vision_config = null;
  config.audio_config = null;
  const tokenizer = await AutoTokenizer.from_pretrained(modelId, options);
  const resourceOwner = createTransformersResourceScope('embedding model components', { drainFailuresBeforeResources: true });
  resourceOwner.adopt(tokenizer, 'embedding tokenizer');
  try {
    const model = await AutoModel.from_pretrained(modelId, {
      ...options, config, device: 'cpu', dtype: plan.dtype, session_options: sessionOptions,
      ...(modelFileName ? { model_file_name: modelFileName } : {})
    });
    resourceOwner.adopt(model, 'embedding text model');
    return { plan, config, tokenizer, model, resourceOwner };
  } catch (error) {
    resourceOwner.retainFailure(error);
    try { await resourceOwner.close(); } catch (cleanup) { throw preserveEmbeddingCleanupFailure(error, cleanup); }
    throw error;
  }
};
