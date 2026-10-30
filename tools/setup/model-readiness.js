import fs from 'node:fs';
import path from 'node:path';
import { resolveEmbeddingArtifactRoot } from '../../src/shared/embedding-artifact-identity.js';
import { normalizeEmbeddingProvider, resolveOnnxConfig, resolveOnnxModelPath } from '../../src/shared/onnx-embeddings/config.js';
import { resolveEmbeddingModelProfile, validateEmbeddingModelProfile } from '../../src/shared/embedding-model-profile.js';
import { EMBEDDING_ACQUISITION_RECEIPT, resolveEmbeddingAcquisitionPlan, resolveEmbeddingAcquisitionRoot } from '../../src/shared/embedding-model-loading.js';
import { readEmbeddingAcquisitionReceipt } from '../../src/shared/embedding-acquisition-receipt.js';
import { assertNoSymlinkPath } from '../../src/shared/contained-file.js';
import { describeStorageFailure } from '../../src/shared/storage/failure-observation.js';

const isMissing = code => code === 'ENOENT' || code === 'ENOTDIR';
const hasReceipt = file => {
  if (!file) return false;
  try {
    fs.lstatSync(file);
    return true;
  } catch (error) {
    const failure = describeStorageFailure(error, { phase: 'setup-model-receipt-presence' });
    if (isMissing(failure.code)) return false;
    throw error;
  }
};

/** Selected local asset presence only: no provider initialization, hashing or inference. */
export const resolveModelSetupReadiness = ({ root, modelConfig, embeddingsConfig = {}, signal = null }) => {
  signal?.throwIfAborted();
  const observations = new Map();
  const inspectFile = file => {
    signal?.throwIfAborted();
    if (!file) return { usable: false, bytes: null };
    if (observations.has(file)) return observations.get(file);
    let result;
    try {
      const stat = fs.statSync(file);
      signal?.throwIfAborted();
      const usable = stat.isFile() && stat.size > 0;
      if (usable) fs.accessSync(file, fs.constants.R_OK);
      signal?.throwIfAborted();
      result = { usable, bytes: stat.size };
    } catch (error) {
      const failure = describeStorageFailure(error, { phase: 'setup-model-asset-presence' });
      signal?.throwIfAborted();
      if (!isMissing(failure.code)) throw error;
      result = { usable: false, bytes: null };
    }
    observations.set(file, result);
    return result;
  };
  const provider = normalizeEmbeddingProvider(embeddingsConfig.provider, { strict: true });
  const onnx = resolveOnnxConfig(embeddingsConfig.onnx || {});
  const modelId = modelConfig.id;
  const modelProfile = resolveEmbeddingModelProfile(modelId, embeddingsConfig.embeddinggemma2);
  const acquisition = resolveEmbeddingAcquisitionPlan(modelId, modelProfile);
  validateEmbeddingModelProfile(modelProfile, { provider, normalize: embeddingsConfig.normalize !== false });
  const tokenizerId = provider === 'onnx' && onnx.tokenizerId ? onnx.tokenizerId : modelId;
  let modelRoot = null, tokenizerRoot = null, reason = null;
  try {
    modelRoot = resolveEmbeddingArtifactRoot(modelId, modelConfig.dir);
    tokenizerRoot = resolveEmbeddingAcquisitionRoot(tokenizerId, modelConfig.dir,
      tokenizerId === modelId ? modelProfile : null);
  } catch (error) {
    describeStorageFailure(error, { phase: 'setup-model-location' });
    throw error;
  }
  signal?.throwIfAborted();
  let modelPath = null;
  try {
    modelPath = provider === 'onnx'
      ? resolveOnnxModelPath({ rootDir: root, modelPath: onnx.modelPath, modelsDir: modelConfig.dir, modelId })
      : modelRoot ? path.join(modelRoot, 'onnx', 'model_quantized.onnx') : null;
  } catch (error) { reason = describeStorageFailure(error, { phase: 'setup-model-selection' }).message; }
  signal?.throwIfAborted();
  // Generic prefetch preserves q8; finite recipes require their selected receipt.
  let assets = {
    weights: modelPath,
    tokenizer: tokenizerRoot ? path.join(tokenizerRoot, 'tokenizer.json') : null,
    tokenizerConfig: tokenizerRoot ? path.join(tokenizerRoot, 'tokenizer_config.json') : null,
    ...(provider === 'xenova' ? { modelConfig: modelRoot ? path.join(modelRoot, 'config.json') : null } : {})
  };
  const selectedRoot = acquisition.revision ? resolveEmbeddingAcquisitionRoot(modelId, modelConfig.dir, modelProfile) : modelRoot;
  const selectedReceipt = selectedRoot ? path.join(selectedRoot, EMBEDDING_ACQUISITION_RECEIPT) : null;
  if (modelProfile || provider === 'xenova' && (acquisition.exportFiles || hasReceipt(selectedReceipt))) {
    assets = {};
    const receiptPath = selectedReceipt;
    try {
      signal?.throwIfAborted();
      if (!receiptPath) throw Object.assign(new Error('Selected model acquisition receipt is missing.'), { code: 'ERR_SETUP_MODEL_INCOMPLETE' });
      const plan = resolveEmbeddingAcquisitionPlan(modelId, modelProfile);
      const receipt = readEmbeddingAcquisitionReceipt(selectedRoot, plan);
      signal?.throwIfAborted();
      for (const row of receipt.inventory) {
        const file = path.join(selectedRoot, ...row.path.split('/'));
        assets[row.path] = file;
        assertNoSymlinkPath(selectedRoot, file);
        const observation = inspectFile(file);
        if (!observation.usable || observation.bytes !== row.bytes) throw Object.assign(
          new Error('Selected model component is missing or truncated.'), { code: 'ERR_SETUP_MODEL_INCOMPLETE' });
      }
      modelPath = Object.values(assets).find(file => file.endsWith('.onnx')) ?? null;
    } catch (error) {
      const failure = describeStorageFailure(error, { phase: 'setup-model-selected-receipt' });
      signal?.throwIfAborted();
      // Missing or incompatible content can be prefetched. An inaccessible,
      // changed or unresolved resource never grants replacement admission.
      if (!isMissing(failure.code) && !['ERR_SETUP_MODEL_INCOMPLETE', 'ERR_EMBEDDING_ACQUISITION'].includes(failure.code)
        && !(error instanceof SyntaxError)) throw error;
      reason = `Selected profile assets require prefetch: ${failure.message}`;
      assets = { acquisitionReceipt: receiptPath };
      modelPath = null;
    }
  }
  const usablePaths = [], missing = [];
  for (const [name, file] of Object.entries(assets)) {
    if (inspectFile(file).usable) usablePaths.push(file);
    else missing.push(name);
  }
  const present = !reason && missing.length === 0;
  return {
    provider, modelId, tokenizerId, modelPath, assets, usablePaths, missing, present,
    partial: !present && usablePaths.length > 0,
    verificationLevel: present ? 'nonempty-readable-selected-assets' : null,
    reason: present ? null : reason || `Selected model assets are missing or unreadable: ${missing.join(', ')}.`
  };
};
