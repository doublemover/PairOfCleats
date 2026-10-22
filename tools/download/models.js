#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import * as transformers from '@huggingface/transformers';
import { normalizeEmbeddingProvider, resolveOnnxConfig, resolveOnnxModelPath } from '../../src/shared/onnx-embeddings.js';
import { isAbsolutePathNative } from '../../src/shared/file-paths.js';
import { DEFAULT_MODEL_ID, getModelConfig, resolveRepoConfig } from '../shared/dict-utils.js';
import { resolveEmbeddingModelProfile, validateEmbeddingModelProfile } from '../../src/shared/embedding-model-profile.js';
import { EMBEDDING_ACQUISITION_RECEIPT, loadEmbeddingModelComponents, resolveEmbeddingAcquisitionRoot } from '../../src/shared/embedding-model-loading.js';
import { installOnnxArtifactClosure } from '../../src/shared/onnx-model-install.js';
import { captureTransformersResource } from '../../src/shared/embedding-transformers-resources.js';
import { preserveEmbeddingCleanupFailure } from '../../src/shared/embedding-cache-lifetime.js';

const argv = createCli({
  scriptName: 'download-models',
  options: {
    model: { type: 'string' },
    'cache-dir': { type: 'string' },
    onnx: { type: 'boolean', default: false },
    'onnx-path': { type: 'string' },
    repo: { type: 'string' }
  }
}).parse();

const { repoRoot: root, userConfig } = resolveRepoConfig(argv.repo);
const modelConfig = getModelConfig(root, userConfig);
const embeddingsConfig = userConfig.indexing?.embeddings || {};
const embeddingProvider = normalizeEmbeddingProvider(embeddingsConfig.provider, { strict: true });
const embeddingOnnx = resolveOnnxConfig(embeddingsConfig.onnx || {});
const cacheDir = argv['cache-dir']
  ? path.resolve(argv['cache-dir'])
  : modelConfig.dir;
const modelId = argv.model || modelConfig.id || DEFAULT_MODEL_ID;
const wantsOnnx = argv.onnx === true || embeddingProvider === 'onnx';
const onnxPathOverride = argv['onnx-path'] ? path.resolve(argv['onnx-path']) : null;
const modelProfile = resolveEmbeddingModelProfile(modelId, embeddingsConfig.embeddinggemma2);
validateEmbeddingModelProfile(modelProfile, { provider: embeddingProvider, normalize: embeddingsConfig.normalize !== false });

await fs.mkdir(cacheDir, { recursive: true });
transformers.env.cacheDir = cacheDir;

// Preserve the quantized model filename used by existing model caches.
const acquired = await loadEmbeddingModelComponents(transformers, { modelId, modelsDir: cacheDir, modelProfile });
const downloadOwner = acquired.resourceOwner || captureTransformersResource(acquired.pipeline, 'downloaded embedding pipeline');
let acquisitionFailure, acquisitionFailed = false;
try {
  if (modelProfile) {
    // Ask the pinned upstream registry for graph/external-data components using
    // the same text-only config and precision that inference just loaded.
    const files = await transformers.ModelRegistry.get_model_files(modelId, {
      config: acquired.config, dtype: modelProfile.dtype, device: 'cpu'
    });
    const assetRoot = resolveEmbeddingAcquisitionRoot(modelId, cacheDir, modelProfile);
    if (!assetRoot) throw new Error('Selected model acquisition has no unambiguous local asset root.');
    const requiredFiles = [...new Set([...files, 'tokenizer.json', 'tokenizer_config.json'])];
    const receiptPath = path.join(assetRoot, EMBEDDING_ACQUISITION_RECEIPT);
    await fs.writeFile(receiptPath, JSON.stringify({ plan: acquired.plan, files: requiredFiles }));
  }
} catch (error) { acquisitionFailed = true; acquisitionFailure = error; throw error; }
finally {
  try { if (acquired.resourceOwner) await downloadOwner.close(); else await downloadOwner.retire(); }
  catch (cleanup) { throw acquisitionFailed ? preserveEmbeddingCleanupFailure(acquisitionFailure, cleanup) : cleanup; }
}

let onnxResolvedPath = null;
if (wantsOnnx) {
  onnxResolvedPath = resolveOnnxModelPath({
    rootDir: root,
    // A configured output may not exist yet. Discover downloaded source assets
    // independently; runtime selection remains authoritative.
    modelPath: null,
    modelsDir: cacheDir,
    modelId
  });
  const onnxTargetRaw = onnxPathOverride || (embeddingProvider === 'onnx' ? embeddingOnnx.modelPath : null);
  const onnxTarget = onnxTargetRaw
    ? (isAbsolutePathNative(onnxTargetRaw) ? onnxTargetRaw : path.resolve(root, onnxTargetRaw))
    : null;
  if (onnxResolvedPath && onnxTarget) {
    const targetStat = (() => {
      try {
        return fsSync.statSync(onnxTarget);
      } catch {
        return null;
      }
    })();
    const looksLikeDir = onnxTargetRaw
      ? (onnxTargetRaw.endsWith(path.sep) || !path.extname(onnxTargetRaw))
      : false;
    const targetIsDir = targetStat ? targetStat.isDirectory() : looksLikeDir;
    const finalTarget = targetIsDir
      ? path.join(onnxTarget, path.basename(onnxResolvedPath))
      : onnxTarget;
    await installOnnxArtifactClosure({ sourceGraph: onnxResolvedPath, targetGraph: finalTarget });
    onnxResolvedPath = resolveOnnxModelPath({ rootDir: root, modelPath: finalTarget, modelsDir: cacheDir, modelId });
  }
}

console.error(`Downloaded model ${modelId} to ${cacheDir}`);
if (wantsOnnx) {
  if (onnxResolvedPath) {
    console.error(`ONNX model available at ${onnxResolvedPath}`);
    console.error('Config: set indexing.embeddings.provider=onnx and indexing.embeddings.onnx.modelPath to that path.');
  } else {
    console.error('ONNX model path not found. Run with --onnx-path or set indexing.embeddings.onnx.modelPath.');
  }
}
