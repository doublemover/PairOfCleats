import assert from 'node:assert/strict';
import { buildEmbeddingIdentity, buildEmbeddingIdentityKey, EMBEDDING_IDENTITY_VERSION } from '../../../src/shared/embedding-identity.js';
import { stableStringify } from '../../../src/shared/stable-json.js';
import { resolveGlobalChunkCacheDir } from '../../../tools/build/embeddings/cache.js';
import { sha1 } from '../../../src/shared/hash.js';

const identity = buildEmbeddingIdentity({ provider: 'onnx', modelId: 'fixture/identity-order', dims: 4,
  modelArtifact: { status: 'verified', reuse: 'allow', digest: 'a'.repeat(64), inventory: [{ path: 'weights/model.onnx', bytes: 30, sha256: 'b'.repeat(64) }] },
  onnx: { modelPath: 'models/model.onnx', tokenizerId: 'fixture/identity-order', executionProviders: ['cpu', 'cuda'] } });
const persisted = JSON.parse(stableStringify(identity));
assert.notEqual(sha1(JSON.stringify(identity)), sha1(JSON.stringify(persisted)),
  'the original failure witness changes insertion order without changing any identity value');
assert.equal(buildEmbeddingIdentityKey(identity), buildEmbeddingIdentityKey(persisted));
assert.equal(resolveGlobalChunkCacheDir('.tmp/identity-order-fixture', identity),
  resolveGlobalChunkCacheDir('.tmp/identity-order-fixture', persisted));
for (const mutate of [value => { value.dims++; }, value => { value.normalize = !value.normalize; },
  value => { value.onnx.executionProviders.reverse(); }, value => { value.modelArtifact.digest = 'c'.repeat(64); },
  value => { value.modelArtifact.inventory[0].bytes++; }, value => { value.version = EMBEDDING_IDENTITY_VERSION - 1; }]) {
  const changed = structuredClone(persisted); mutate(changed);
  assert.notEqual(buildEmbeddingIdentityKey(identity), buildEmbeddingIdentityKey(changed));
}
console.log('Persisted embedding identity preserves canonical cache paths while every semantic and ordered-provider change invalidates reuse');
