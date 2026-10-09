import assert from 'node:assert/strict';
import { createQualifiedGgufEmbeddingRuntime, resolveGgufQualification } from '../../../src/integrations/inference-history/gguf-embedding-runtime.js';

const manifest = {
  schema: 'history-eg2-gguf.v1', endpoint: 'http://127.0.0.1:1234',
  alias: 'qualified-eg2-test', instanceId: 'instance-one', deviceIdentifier: null,
  ggufSha256: 'a'.repeat(64), tokenizerSha256: 'b'.repeat(64),
  engineBuild: 'test-only', engineCommit: 'c'.repeat(40), supportEvidenceSha256: 'd'.repeat(64),
  qualificationReceiptSha256: 'e'.repeat(64), precision: 'bf16-fp32-accumulation',
  backend: 'cpu-fixture', architecture: 'gemma-embedding2',
  pooling: 'native-eg2-mask-aware-pooling', projection: 'native-eg2-learned-768',
  dimensions: 768, passagePrefix: 'title: none | text: ',
  queryPrefix: 'task: search result | query: ',
  tokenizerPolicy: 'exact-prefixed-input-with-special-tokens-no-truncation'
};
const response = (data = [{ index: 0, embedding: [1, ...Array(767).fill(0)] }]) =>
  new Response(JSON.stringify({ model: manifest.alias, data }));
const dependencies = { verifyLoadedInstance: async () => manifest, countTokens: text => text.length,
  fetchImpl: async () => response() };
for (const patch of [
  { endpoint: 'http://localhost:1234' }, { endpoint: 'http://127.0.0.1:1234/remote' },
  { endpoint: 'http://user:password@127.0.0.1:1234' }, { deviceIdentifier: 'remote' },
  { precision: 'fp16' }, { projection: 'hidden-state-512' }, { engineCommit: 'unknown' },
  { qualificationReceiptSha256: null }
]) assert.throws(() => resolveGgufQualification({ ...manifest, ...patch }));
const a = resolveGgufQualification(manifest);
const b = resolveGgufQualification({ ...manifest, queryPrefix: 'task: code retrieval | query: ' });
assert.equal(a.documentIdentityKey, b.documentIdentityKey);
assert.notEqual(a.queryIdentityKey, b.queryIdentityKey);
assert.equal(a.representationIdentityKey, b.representationIdentityKey);
for (const patch of [{ ggufSha256: 'f'.repeat(64) }, { backend: 'different-qualified-backend' }]) {
  const changed = resolveGgufQualification({ ...manifest, ...patch });
  assert.notEqual(a.documentIdentityKey, changed.documentIdentityKey);
  assert.notEqual(a.queryIdentityKey, changed.queryIdentityKey);
  assert.notEqual(a.representationIdentityKey, changed.representationIdentityKey);
}
let active = 0, peak = 0;
const captured = [];
const runtime = createQualifiedGgufEmbeddingRuntime(manifest, {
  ...dependencies,
  fetchImpl: async (_, options) => {
    assert.equal(options.redirect, 'error');
    active++; peak = Math.max(peak, active);
    captured.push(JSON.parse(options.body));
    await new Promise(resolve => setTimeout(resolve, 3));
    active--;
    return response();
  }
});
const [batch, query] = await Promise.all([
  runtime.encodeBatch(['  code\nline\t😀  ', 'second']), runtime.encodeQuery(' exact\nquery ')
]);
assert.equal(peak, 1);
assert.equal(batch.length, 2); assert.equal(query.length, 768);
assert.deepEqual(captured.map(item => item.input), [
  manifest.passagePrefix + '  code\nline\t😀  ', manifest.passagePrefix + 'second',
  manifest.queryPrefix + ' exact\nquery '
]);
assert.ok(captured.every(item => typeof item.input === 'string' && !Object.hasOwn(item, 'dimensions')));
assert.equal(runtime.admissionStatus().queuedInputs, 0);
for (const invalid of [
  [{ index: 1, embedding: [1, ...Array(767).fill(0)] }],
  [{ index: 0, embedding: Array(512).fill(0) }],
  [{ index: 0, embedding: Array(768).fill(0) }],
  [{ index: 0, embedding: [null, ...Array(767).fill(0)] }],
  [{ index: 0, embedding: [1, ...Array(767).fill(0)] }, { index: 0, embedding: [] }]
]) {
  const bad = createQualifiedGgufEmbeddingRuntime(manifest, { ...dependencies,
    fetchImpl: async () => response(invalid) });
  await assert.rejects(bad.encodeQuery('bad'));
  assert.equal(bad.admissionStatus().poisoned, true);
}
let calls = 0;
const hung = createQualifiedGgufEmbeddingRuntime(manifest, { ...dependencies,
  bounds: { timeoutMs: 10 }, fetchImpl: () => { calls++; return new Promise(() => {}); } });
const first = hung.encodeQuery('first');
const second = hung.encodeQuery('second');
await assert.rejects(first, /native execution/);
await assert.rejects(second, /admission stopped/);
assert.equal(calls, 1);
assert.equal(hung.admissionStatus().poisoned, true);
const tooLong = createQualifiedGgufEmbeddingRuntime(manifest, { ...dependencies,
  countTokens: () => 2049 });
assert.throws(() => tooLong.encodeBatch(['long']), /never truncated/);
const overflow = createQualifiedGgufEmbeddingRuntime(manifest, { ...dependencies,
  bounds: { maxResponseBytes: 10 } });
await assert.rejects(overflow.encodeQuery('size'), /response exceeds/);
const changed = createQualifiedGgufEmbeddingRuntime(manifest, { ...dependencies,
  verifyLoadedInstance: async () => ({ ...manifest, instanceId: 'new-instance' }) });
await assert.rejects(changed.encodeQuery('private'), /instance changed/);
assert.equal(changed.admissionStatus().poisoned, false); // No embedding dispatched.
const cancel = new AbortController(); cancel.abort(new Error('cancelled before admission'));
await assert.rejects(runtime.encodeQuery('cancel', { signal: cancel.signal }), /cancelled/);
console.log('qualified GGUF single-flight fixture passed (no model/runtime loaded)');
