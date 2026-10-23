import assert from 'node:assert/strict';
import { createDeferredEmbeddingAdapter } from '../../../src/shared/embedding-deferred-adapter.js';

for (const marker of [undefined, false, true]) {
  let settled = false, substitute = false, observerReads = 0, loads = 0;
  const error = new Error('controlled original startup resource');
  Object.defineProperties(error, { cacheOwnershipPending: { value: marker }, cacheOwnershipReleased: { get() {
    observerReads++; return substitute ? () => true : function () { assert.equal(this, error); return settled; };
  } } }); Object.freeze(error);
  const adapter = createDeferredEmbeddingAdapter({ provider: 'controlled', methods: ['embedOne'],
    acquire: async () => { loads++; throw error; } });
  await assert.rejects(adapter.embedOne('inert query'), value => value === error);
  assert.equal(observerReads, 1);
  substitute = true;
  await assert.rejects(adapter.dispose(), value => value === error, 'an original observer is authoritative even without a true marker');
  assert.equal(observerReads, 1, 'disposal retains the original observer and its receiver');
  settled = true; await adapter.dispose(); assert.equal(loads, 1);
}
for (const error of [undefined, null, false, Object.freeze(new Error('ordinary startup failure'))]) {
  const adapter = createDeferredEmbeddingAdapter({ provider: 'controlled', methods: ['embedOne'], acquire: async () => { throw error; } });
  await adapter.embedOne('ordinary failure').then(() => assert.fail('must reject'), value => assert.equal(value, error));
  await adapter.dispose();
}
console.log('Deferred provider startup lifetime and original observer retention controls authored; execution deferred.');
