#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createEmbeddingResolver } from '../../../src/retrieval/cli/run-search-session/embedding-cache.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// Inert selected bytes establish reusable artifact identity; the injected
// implementation below does not load or qualify a native model.
const rootDir = await makeTempDir('poc-query-dims-');
const modelsDir = path.join(rootDir, 'models');
const modelRoot = path.join(modelsDir, 'demo-model');
try {
  await fs.mkdir(path.join(modelRoot, 'onnx'), { recursive: true });
  await fs.writeFile(path.join(modelRoot, 'onnx', 'model.onnx'), 'fixture selected weights');
  await fs.writeFile(path.join(modelRoot, 'tokenizer.json'), '{"fixture":"tokenizer"}');
  const calls = [];
  const resolver = createEmbeddingResolver({
    throwIfAborted: () => {},
    embeddingQueryText: 'howdy',
    modelConfig: { dir: modelsDir },
    useStubEmbeddings: false,
    embeddingProvider: 'onnx',
    embeddingOnnx: {},
    rootDir,
    maxCacheEntries: 1,
    getQueryEmbeddingImpl: async ({ dims }) => {
      calls.push(dims);
      return new Float32Array(Math.max(1, Number(dims) || 1));
    }
  });

  await resolver('demo-model', 512, true, null);
  await resolver('demo-model', 768, true, null);
  await resolver('demo-model', 512, true, null);

  assert.deepEqual(
    calls,
    [512, 768, 512],
    'expected dims-aware cache keys and bounded eviction to trigger fresh fetches'
  );

  const nonPositiveCalls = [];
  const nonPositiveResolver = createEmbeddingResolver({
    throwIfAborted: () => {},
    embeddingQueryText: 'howdy',
    modelConfig: { dir: modelsDir },
    useStubEmbeddings: false,
    embeddingProvider: 'onnx',
    embeddingOnnx: {},
    rootDir,
    maxCacheEntries: 4,
    getQueryEmbeddingImpl: async ({ dims }) => {
      nonPositiveCalls.push(dims);
      return new Float32Array(1);
    }
  });
  await nonPositiveResolver('demo-model', 0, true, null);
  await nonPositiveResolver('demo-model', null, true, null);

  assert.deepEqual(
    nonPositiveCalls,
    [null],
    'expected non-positive dims to normalize to provider default cache key'
  );

  console.log('embedding query cache dims+lru test passed');
} finally { await rmDirRecursive(rootDir); }
