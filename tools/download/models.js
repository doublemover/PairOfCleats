#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { pipeline, env } from '@xenova/transformers';
import { normalizeEmbeddingProvider, normalizeOnnxConfig, resolveOnnxModelPath } from '../../src/shared/onnx-embeddings.js';
import { isAbsolutePathNative } from '../../src/shared/files.js';
import { DEFAULT_MODEL_ID, getModelConfig, resolveRepoConfig } from '../shared/dict-utils.js';

const argv = createCli({
  scriptName: 'download-models',
  options: {
    model: { type: 'string', default: DEFAULT_MODEL_ID },
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
const embeddingOnnx = normalizeOnnxConfig(embeddingsConfig.onnx || {});
const cacheDir = argv['cache-dir']
  ? path.resolve(argv['cache-dir'])
  : modelConfig.dir;
const modelId = argv.model || modelConfig.id || DEFAULT_MODEL_ID;
const wantsOnnx = argv.onnx === true || embeddingProvider === 'onnx';
const onnxPathOverride = argv['onnx-path'] ? path.resolve(argv['onnx-path']) : null;

await fs.mkdir(cacheDir, { recursive: true });
env.cacheDir = cacheDir;

await pipeline('feature-extraction', modelId);

let onnxResolvedPath = null;
if (wantsOnnx) {
  onnxResolvedPath = resolveOnnxModelPath({
    rootDir: root,
    modelPath: embeddingOnnx.modelPath,
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
    const resolvedFinal = path.resolve(finalTarget);
    const resolvedSource = path.resolve(onnxResolvedPath);
    if (!fsSync.existsSync(resolvedFinal) && resolvedFinal !== resolvedSource) {
      await fs.mkdir(path.dirname(finalTarget), { recursive: true });
      await fs.copyFile(onnxResolvedPath, finalTarget);
      onnxResolvedPath = finalTarget;
    }
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
