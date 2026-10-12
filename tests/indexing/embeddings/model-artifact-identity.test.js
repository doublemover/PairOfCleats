#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveEmbeddingArtifactIdentity, assertEmbeddingArtifactCompatibility } from '../../../src/shared/embedding-artifact-identity.js';
import { buildEmbeddingIdentity, buildEmbeddingIdentityKey } from '../../../src/shared/embedding-identity.js';
import { createEmbeddingResolver } from '../../../src/retrieval/cli/run-search-session/embedding-cache.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('model-artifact-identity');
const modelsDir = path.join(dir, 'models'), modelId = 'fixture';
const modelRoot = path.join(modelsDir, modelId);
await fs.mkdir(path.join(modelRoot, 'onnx'), { recursive: true });
const modelPath = path.join(modelRoot, 'onnx', 'model.onnx');
const tokenizerPath = path.join(modelRoot, 'tokenizer.json');
await fs.writeFile(modelPath, 'weights-A');
await fs.writeFile(tokenizerPath, '{"vocab":"A"}');
const options = { provider: 'onnx', modelId, modelsDir, rootDir: dir, onnx: { modelPath } };
const identify = () => resolveEmbeddingArtifactIdentity(options);
const identity = artifact => buildEmbeddingIdentity({ ...options, dims: 3, modelArtifact: artifact });
try {
  const first = identify(), unchanged = identify();
  assert.equal(first.status, 'verified');
  assert.deepEqual(first, unchanged);
  assert.equal(buildEmbeddingIdentityKey(identity(first)), buildEmbeddingIdentityKey(identity(unchanged)));
  assertEmbeddingArtifactCompatibility(first, unchanged);
  await fs.writeFile(modelPath, 'weights-B');
  const weightsChanged = identify();
  assert.notEqual(first.digest, weightsChanged.digest);
  assert.throws(() => assertEmbeddingArtifactCompatibility(first, weightsChanged), { code: 'ERR_EMBEDDING_ARTIFACT_INCOMPATIBLE' });
  await fs.writeFile(modelPath, 'weights-A');
  await fs.writeFile(tokenizerPath, '{"vocab":"B"}');
  const tokenizerChanged = identify();
  assert.notEqual(first.digest, tokenizerChanged.digest);
  assert.notEqual(buildEmbeddingIdentityKey(identity(first)), buildEmbeddingIdentityKey(identity(tokenizerChanged)));
  let calls = 0;
  const resolver = createEmbeddingResolver({ throwIfAborted() {}, embeddingQueryText: 'test',
    modelConfig: { dir: modelsDir }, embeddingProvider: 'onnx', embeddingOnnx: { modelPath }, rootDir: dir,
    getQueryEmbeddingImpl: async () => { calls++; return [1, 2, 3]; } });
  await assert.rejects(resolver(modelId, 3, true, null, null, identity(first)), { code: 'ERR_EMBEDDING_ARTIFACT_INCOMPATIBLE' });
  assert.equal(calls, 0, 'incompatible query cannot initialize a provider or reuse a cached vector');
  await fs.rm(tokenizerPath);
  const unknownA = identify(), unknownB = identify();
  assert.equal(unknownA.status, 'unknown');
  assert.equal(unknownA.reuse, 'refuse');
  assert.notEqual(buildEmbeddingIdentityKey(identity(unknownA)), buildEmbeddingIdentityKey(identity(unknownB)),
    'unverified newly computed outputs belong to one attempt and cannot authorize another build');
  assert.throws(() => assertEmbeddingArtifactCompatibility(unknownA, unknownA), { code: 'ERR_EMBEDDING_ARTIFACT_INCOMPATIBLE' });
  await assert.rejects(resolver(modelId, 3, true, null, null, { ...identity(first), version: 3 }),
    { code: 'ERR_EMBEDDING_IDENTITY_UNSUPPORTED' });
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Verified weights/tokenizer identity, unknown attempt isolation and actual query compatibility boundary pass.');
