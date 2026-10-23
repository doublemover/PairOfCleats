import fs from 'node:fs';
import path from 'node:path';
import { resolveEmbeddingArtifactRoot } from '../../src/shared/embedding-artifact-identity.js';
import { normalizeEmbeddingProvider, resolveOnnxConfig, resolveOnnxModelPath } from '../../src/shared/onnx-embeddings/config.js';
import { resolveEmbeddingModelProfile, validateEmbeddingModelProfile } from '../../src/shared/embedding-model-profile.js';
import { EMBEDDING_ACQUISITION_RECEIPT, resolveEmbeddingAcquisitionPlan, resolveEmbeddingAcquisitionRoot } from '../../src/shared/embedding-model-loading.js';
import { readEmbeddingAcquisitionReceipt } from '../../src/shared/embedding-acquisition-receipt.js';
import { assertNoSymlinkPath } from '../../src/shared/contained-file.js';

const isUsableFile = (file) => {
  if (!file) return false;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size === 0) return false;
    fs.accessSync(file, fs.constants.R_OK);
    return true;
  } catch { return false; }
};

/** Selected local asset presence only: no provider initialization, hashing or inference. */
export const resolveModelSetupReadiness = ({ root, modelConfig, embeddingsConfig = {} }) => {
  const provider = normalizeEmbeddingProvider(embeddingsConfig.provider, { strict: true });
  const onnx = resolveOnnxConfig(embeddingsConfig.onnx || {});
  const modelId = modelConfig.id;
  const modelProfile = resolveEmbeddingModelProfile(modelId, embeddingsConfig.embeddinggemma2);
  validateEmbeddingModelProfile(modelProfile, { provider, normalize: embeddingsConfig.normalize !== false });
  const tokenizerId = provider === 'onnx' && onnx.tokenizerId ? onnx.tokenizerId : modelId;
  let modelRoot = null, tokenizerRoot = null, reason = null;
  try {
    modelRoot = resolveEmbeddingArtifactRoot(modelId, modelConfig.dir);
    tokenizerRoot = resolveEmbeddingArtifactRoot(tokenizerId, modelConfig.dir);
  } catch (error) { reason = `Selected model asset location cannot be inspected: ${error.message}`; }
  let modelPath = null;
  try {
    modelPath = provider === 'onnx'
      ? resolveOnnxModelPath({ rootDir: root, modelPath: onnx.modelPath, modelsDir: modelConfig.dir, modelId })
      : modelRoot ? path.join(modelRoot, 'onnx', 'model_quantized.onnx') : null;
  } catch (error) { reason = error.message; }
  // The prefetch owner selects q8; the pinned tokenizer loader uses these two files.
  let assets = {
    weights: modelPath,
    tokenizer: tokenizerRoot ? path.join(tokenizerRoot, 'tokenizer.json') : null,
    tokenizerConfig: tokenizerRoot ? path.join(tokenizerRoot, 'tokenizer_config.json') : null,
    ...(provider === 'xenova' ? { modelConfig: modelRoot ? path.join(modelRoot, 'config.json') : null } : {})
  };
  const selectedRoot = modelProfile ? resolveEmbeddingAcquisitionRoot(modelId, modelConfig.dir, modelProfile) : modelRoot;
  const selectedReceipt = selectedRoot ? path.join(selectedRoot, EMBEDDING_ACQUISITION_RECEIPT) : null;
  if (modelProfile || provider === 'xenova' && selectedReceipt && fs.existsSync(selectedReceipt)) {
    assets = {};
    const receiptPath = selectedReceipt;
    try {
      if (!receiptPath) throw new Error('Selected model acquisition receipt is missing.');
      const plan = resolveEmbeddingAcquisitionPlan(modelId, modelProfile);
      const receipt = readEmbeddingAcquisitionReceipt(selectedRoot, plan);
      for (const row of receipt.inventory) {
        const file = path.join(selectedRoot, ...row.path.split('/'));
        assets[row.path] = file;
        assertNoSymlinkPath(selectedRoot, file);
        if (!isUsableFile(file) || fs.statSync(file).size !== row.bytes) throw new Error('Selected model component is missing, unreadable or truncated.');
      }
      modelPath = Object.values(assets).find(file => file.endsWith('.onnx')) ?? null;
    } catch (error) {
      reason = `Selected profile assets require prefetch: ${error.message}`;
      assets = { acquisitionReceipt: receiptPath };
      modelPath = null;
    }
  }
  const usablePaths = Object.values(assets).filter(isUsableFile);
  const missing = Object.keys(assets).filter(name => !isUsableFile(assets[name]));
  const present = !reason && missing.length === 0;
  return {
    provider, modelId, tokenizerId, modelPath, assets, usablePaths, missing, present,
    partial: !present && usablePaths.length > 0,
    verificationLevel: present ? 'nonempty-readable-selected-assets' : null,
    reason: present ? null : reason || `Selected model assets are missing or unreadable: ${missing.join(', ')}.`
  };
};
