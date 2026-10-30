import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { createNativeBridgeManifestFixture } from '../../helpers/native-bridge-manifest.js';

const moduleUrl = new URL('../../../src/index/semantic/boundaries/native-manifest.js', import.meta.url).href;
const identityUrl = new URL('../../../src/index/semantic/identity.js', import.meta.url).href;
const state = { manifest: null, calls: [], encodedContainers: 0, rootCompleted: false };
globalThis.nativeManifestByteFixture = state;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === moduleUrl + '?bounded-fixture' && specifier === '../identity.js') return { url: 'native-manifest:canonical', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'native-manifest:canonical') return { format: 'module', shortCircuit: true, source: `
      import {canonicalSemanticJson as original} from ${JSON.stringify(identityUrl)};
      export const canonicalSemanticJson=(value,options)=>{
        const state=globalThis.nativeManifestByteFixture;
        state.calls.push({isManifest:value===state.manifest,maxBytes:options?.maxBytes});
        return original(value,{...options,onObjectEncoded:(item)=>{
          state.encodedContainers++;if(item===state.manifest)state.rootCompleted=true;}});
      };` };
    return next(url, context);
  }
});
// Independent tiny-fixture canonical oracle. Never pass the amplified rejected
// fixture to this materializing helper; the actual encoder owns that admission.
const tinyCanonical = value => Array.isArray(value) ? '[' + value.map(tinyCanonical).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + tinyCanonical(value[key])).join(',') + '}'
    : JSON.stringify(value);
try {
  const { admitNativeBridgeManifest } = await import(moduleUrl + '?bounded-fixture');
  const { manifest, args } = createNativeBridgeManifestFixture();
  const admit = (input, maxBytes) => {
    state.manifest = input; state.calls.length = 0; state.encodedContainers = 0; state.rootCompleted = false;
    return admitNativeBridgeManifest({ ...args, manifest: input, ...(maxBytes === undefined ? {} : { maxBytes }) });
  };
  for (const maxBytes of [0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    let inspected = 0;
    const raw = new Proxy({}, { ownKeys() { inspected++; throw new Error('input must remain untouched'); } });
    assert.throws(() => admit(raw, maxBytes), { code: 'ERR_NATIVE_BRIDGE_MANIFEST' });
    assert.equal(inspected, 0); assert.equal(state.calls.length, 0, 'maxBytes admission precedes encoder/traversal');
  }
  const wrappers = Array.from({ length: 8 }, () => 'x'.repeat(512));
  const expanded = { ...manifest, bindings: Array.from({ length: 64 }, (_, index) => ({
    ...manifest.bindings[0], id: `b${index}`, wrapperChain: wrappers
  })) };
  const nativeClone = globalThis.structuredClone; let clones = 0;
  globalThis.structuredClone = value => { clones++; return nativeClone(value); };
  try {
    assert.throws(() => admit(expanded, 4096), { code: 'ERR_SEMANTIC_JSON_BUDGET' });
    assert.equal(state.rootCompleted, false); assert.equal(state.calls.length, 1);
    assert.deepEqual(state.calls[0], { isManifest: true, maxBytes: 4096 });
    assert.ok(state.encodedContainers < expanded.bindings.length, 'rejection precedes complete binding expansion');
    assert.equal(clones, 0, 'rejected input cannot reach a full graph clone');
  } finally { globalThis.structuredClone = nativeClone; }
  for (const value of ['ascii', 'é 水 😀', '\ud800', '\udc00', '\n\\"\u0001']) {
    const input = { ...manifest, bindings: [{ ...manifest.bindings[0], wrapperChain: [value] }] };
    const canonical = tinyCanonical(input), bytes = Buffer.byteLength(canonical);
    const expected = createHash('sha256').update('pairofcleats.native-bridge-manifest.v1\0').update(canonical).digest('hex');
    const admitted = admit(input, bytes);
    assert.equal(admitted.manifestId, expected, 'identity uses exactly the independently authored canonical bytes');
    assert.deepEqual(admitted.manifest, input); assert.notEqual(admitted.manifest, input);
    assert.equal(state.calls.filter(call => call.isManifest).length, 1, 'full manifest encodes once, including hashing');
    assert.ok(state.calls.every(call => call.maxBytes === bytes));
    assert.equal(Object.isFrozen(admitted.manifest.bindings[0].wrapperChain), true);
    assert.throws(() => admit(input, bytes - 1), { code: 'ERR_SEMANTIC_JSON_BUDGET' });
  }
  const sharedChain = ['wrapper-a', 'wrapper-😀'];
  const shared = { ...manifest, bindings: Array.from({ length: 4 }, (_, index) => ({ ...manifest.bindings[0], id: `b${index}`, wrapperChain: sharedChain })) };
  const copied = { ...shared, bindings: shared.bindings.map(binding => ({ ...binding, wrapperChain: [...sharedChain] })) };
  const sharedBytes = Buffer.byteLength(tinyCanonical(shared));
  const first = admit(shared, sharedBytes), second = admit(copied, sharedBytes);
  assert.equal(first.manifestId, second.manifestId); assert.deepEqual(first.manifest, second.manifest);
  sharedChain.push('later caller mutation'); shared.bindings[0].pythonCallable = 'changed';
  assert.deepEqual(first.manifest.bindings[0].wrapperChain, ['wrapper-a', 'wrapper-😀']);
  assert.equal(first.manifest.bindings[0].pythonCallable, manifest.bindings[0].pythonCallable);
  let getters = 0;
  const accessor = { ...manifest };
  Object.defineProperty(accessor, 'bindings', { enumerable: true, get() { getters++; return manifest.bindings; } });
  assert.throws(() => admit(accessor), { code: 'ERR_NATIVE_BRIDGE_MANIFEST' }); assert.equal(getters, 0);
} finally { hooks.deregister(); delete globalThis.nativeManifestByteFixture; }
console.log('Native bridge manifests admit logical canonical bytes before expansion/capture and hash the same owned immutable representation.');
