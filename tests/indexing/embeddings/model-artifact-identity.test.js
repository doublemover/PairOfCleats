#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveEmbeddingArtifactIdentity, assertEmbeddingArtifactCompatibility } from '../../../src/shared/embedding-artifact-identity.js';
import { buildEmbeddingIdentity, buildEmbeddingIdentityKey } from '../../../src/shared/embedding-identity.js';
import { createEmbeddingResolver } from '../../../src/retrieval/cli/run-search-session/embedding-cache.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { resolveEmbeddingIntent } from '../../../src/shared/embedding-intent.js';

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
  // Only the tokenizer selected by the loader can authorize reuse. Adjacent
  // files at an explicit weights path are not evidence for an alternate ID.
  await fs.writeFile(path.join(path.dirname(modelPath), 'tokenizer.json'), '{"vocab":"unselected"}');
  const missingTokenizer = resolveEmbeddingArtifactIdentity({ ...options,
    onnx: { modelPath, tokenizerId: 'alternate/missing' } });
  assert.equal(missingTokenizer.status, 'unknown');
  assert.equal(missingTokenizer.reuse, 'refuse');
  for (const tokenizerId of ['alternate/selected', path.join(dir, 'absolute-tokenizer')]) {
    const selectedRoot = path.isAbsolute(tokenizerId) ? tokenizerId : path.join(modelsDir, tokenizerId);
    await fs.mkdir(selectedRoot, { recursive: true });
    const selectedPath = path.join(selectedRoot, 'tokenizer.json');
    const selectedOptions = { ...options, onnx: { modelPath, tokenizerId } };
    await fs.writeFile(selectedPath, '{"vocab":"selected-A"}');
    const selectedA = resolveEmbeddingArtifactIdentity(selectedOptions);
    assert.equal(selectedA.status, 'verified');
    assert.ok(selectedA.inventory.some(item => item.path === 'tokenizer/tokenizer.json'));
    await fs.writeFile(selectedPath, '{"vocab":"selected-B"}');
    const selectedB = resolveEmbeddingArtifactIdentity(selectedOptions);
    assert.notEqual(selectedA.digest, selectedB.digest, 'selected tokenizer bytes belong to the authority');
    assert.throws(() => assertEmbeddingArtifactCompatibility(selectedA, selectedB),
      { code: 'ERR_EMBEDDING_ARTIFACT_INCOMPATIBLE' });
    await fs.writeFile(path.join(path.dirname(modelPath), 'tokenizer.json'), '{"vocab":"irrelevant"}');
    assert.equal(resolveEmbeddingArtifactIdentity(selectedOptions).digest, selectedB.digest);
    // POSIX join can form a valid cache shadow of an absolute path. On Windows
    // that join embeds a second drive letter and is not a creatable path.
    if (path.isAbsolute(tokenizerId) && process.platform !== 'win32') {
      const shadow = path.join(modelsDir, tokenizerId);
      await fs.mkdir(shadow, { recursive: true });
      await fs.writeFile(path.join(shadow, 'tokenizer.json'), '{"vocab":"cache-shadow"}');
      assert.equal(resolveEmbeddingArtifactIdentity(selectedOptions).status, 'unknown',
        'a cache shadow cannot falsely verify the direct local tokenizer');
      await fs.rm(shadow, { recursive: true, force: true });
    }
  }
  const originalCwd = process.cwd();
  try {
    process.chdir(dir);
    const localId = 'local/vendor/model';
    await fs.mkdir(path.join(localId, 'onnx'), { recursive: true });
    await fs.writeFile(path.join(localId, 'onnx/model.onnx'), 'local weights');
    await fs.writeFile(path.join(localId, 'tokenizer.json'), '{"vocab":"local"}');
    assert.equal(resolveEmbeddingArtifactIdentity({ provider: 'xenova', modelId: localId }).status, 'verified',
      'bare multi-component local model directories retain their loader identity');
    assert.equal(resolveEmbeddingArtifactIdentity({ ...options,
      onnx: { modelPath, tokenizerId: localId } }).status, 'verified');
  } finally { process.chdir(originalCwd); }
  let calls = 0;
  const stubArtifact = resolveEmbeddingArtifactIdentity({ ...options, stub: true });
  for (const intentInput of [{ envConfig: { embeddings: 'stub' } },
    { argv: { 'stub-embeddings': true } }, { embeddingsConfig: { mode: 'stub' } }]) {
    const intent = resolveEmbeddingIntent({ ...intentInput, execution: 'query' });
    const stubResolver = createEmbeddingResolver({ throwIfAborted() {}, embeddingQueryText: 'stub',
      modelConfig: { dir: modelsDir }, ...intent, rootDir: dir,
      getQueryEmbeddingImpl: async input => { assert.equal(input.useStub, true); return [1, 2, 3]; } });
    assert.deepEqual(await stubResolver(modelId, 3, true, null, null, identity(stubArtifact)), [1, 2, 3]);
    await assert.rejects(stubResolver(modelId, 3, true, null, null, identity(first)),
      { code: 'ERR_EMBEDDING_ARTIFACT_INCOMPATIBLE' }, 'stub selection cannot reuse real model artifacts');
  }
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
