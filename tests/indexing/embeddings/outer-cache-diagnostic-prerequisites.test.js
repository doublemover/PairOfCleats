import assert from 'node:assert/strict';
import { createEmbeddingCacheLifetime, getEmbeddingFailureProvenance, preserveEmbeddingCleanupFailure }
  from '../../../src/shared/embedding-cache-lifetime.js';

// Actual cache owner and composition with inert disposers. No model, native
// runtime, process, global cache, GC or filesystem operations; UNVALIDATED.
const rejected = async work => {
  let rejected = false, failure;
  try { await work; } catch (error) { rejected = true; failure = error; }
  assert.equal(rejected, true); return failure;
};
const controlled = () => {
  const cache = new Map(), lifetime = createEmbeddingCacheLifetime({ cache, kind: 'inert-diagnostic-prerequisite' });
  const entry = lifetime.adopt({ key: 'actual-entry', references: 0 });
  let closes = 0;
  const resource = { dispose() { assert.equal(this, resource); closes++; } };
  lifetime.loaded(entry, resource); entry.promise = Promise.resolve(resource); cache.set(entry.key, entry);
  return { lifetime, entry, resource, get closes() { return closes; } };
};

{
  const owner = controlled();
  let settled = false, observerReads = 0, messageReads = 0;
  const diagnostic = {};
  Object.defineProperties(diagnostic, {
    cacheOwnershipPending: { value: false },
    cacheOwnershipReleased: { configurable: true, get() {
      observerReads++;
      return function () { assert.equal(this, diagnostic); return settled; };
    } }
  });
  const primary = Object.freeze(Object.defineProperties(new Error('original operation'), {
    message: { get() { messageReads++; throw diagnostic; } },
    code: { value: 'EORIGINAL', enumerable: true },
    detail: { get() { assert.equal(this, primary); return 'original receiver'; } }
  }));
  owner.lifetime.recordFailure(owner.entry, primary);
  Object.defineProperty(diagnostic, 'cacheOwnershipReleased', { value: () => true });
  const failure = await rejected(owner.lifetime.retire(owner.entry));
  assert.equal(owner.closes, 0, 'independent diagnostic work gates the actual captured disposer');
  assert.equal(failure.cause, primary);
  assert.deepEqual(failure.errors, [primary, diagnostic]);
  assert.deepEqual(failure.embeddingCacheInspectionErrors, [diagnostic]);
  assert.deepEqual(getEmbeddingFailureProvenance(failure).children, [primary, diagnostic],
    'private producer traversal must retain independent diagnostic work');
  assert.equal(failure.code, 'EORIGINAL');
  assert.equal(Object.getOwnPropertyDescriptor(failure, 'code').writable, false);
  assert.equal(failure.detail, 'original receiver');
  assert.equal(failure.cacheOwnershipReleased(), false);
  assert.equal(await rejected(owner.lifetime.retire(owner.entry)), failure);
  await rejected(owner.entry.owner.release());
  assert.equal(owner.closes, 0, 'callback replacement cannot permit cleanup');
  assert.equal(messageReads, 1); assert.equal(observerReads, 1);
  settled = true;
  await owner.entry.owner.release();
  await owner.entry.owner.release();
  assert.equal(owner.closes, 1, 'remember successful physical disposal after original diagnostic work settles');
  assert.equal(failure.cacheOwnershipReleased(), true);
  assert.equal(owner.lifetime.retiredOwners().length, 0);
}

{
  const owner = controlled();
  let messageReads = 0, stackDescriptors = 0;
  const actual = Object.defineProperties(new Error('unused initial message'), {
    message: { configurable: true, get() { messageReads++; if (messageReads > 1) throw new Error('message reread'); return 'captured once'; } },
    code: { value: 'ENATIVE' }
  });
  const primary = new Proxy(actual, { getOwnPropertyDescriptor(target, key) {
    if (key === 'stack') { stackDescriptors++; throw new Error('lazy stack must not be inspected'); }
    return Reflect.getOwnPropertyDescriptor(target, key);
  } });
  owner.resource.dispose = () => assert.fail('original disposer must remain captured');
  const combined = preserveEmbeddingCleanupFailure(primary, Object.freeze(new Error('independent cleanup')));
  assert.equal(combined.message, 'captured once');
  assert.equal(combined.code, 'ENATIVE');
  owner.lifetime.recordFailure(owner.entry, primary);
  await owner.lifetime.retire(owner.entry);
  assert.equal(owner.closes, 1);
  assert.equal(messageReads, 1); assert.equal(stackDescriptors, 0);
}

for (const thrown of [undefined, null, false, 0, '']) {
  const owner = controlled();
  const primary = Object.freeze(Object.defineProperty(new Error('ordinary primary'), 'message', { get() { throw thrown; } }));
  const cleanup = Object.freeze(new Error('ordinary independent cleanup'));
  const combined = preserveEmbeddingCleanupFailure(primary, cleanup);
  assert.equal(combined.cause, primary);
  assert.deepEqual(combined.errors, [primary, cleanup, thrown]);
  assert.deepEqual(combined.cleanupErrors, [cleanup]);
  assert.deepEqual(combined.embeddingCacheInspectionErrors, [thrown]);
  owner.lifetime.recordFailure(owner.entry, primary);
  await owner.lifetime.retire(owner.entry);
  assert.equal(owner.closes, 1, 'an ordinary falsey inspector failure is retained without inventing pending native work');
}

{
  let primarySettled = false, cleanupSettled = false;
  const primaryDiagnostic = Object.freeze({ cacheOwnershipReleased() { assert.equal(this, primaryDiagnostic); return primarySettled; } });
  const cleanupDiagnostic = Object.freeze({ cacheOwnershipReleased() { assert.equal(this, cleanupDiagnostic); return cleanupSettled; } });
  const primary = Object.freeze(Object.defineProperty(new Error('primary'), 'message', { get() { throw primaryDiagnostic; } }));
  const cleanup = Object.freeze(Object.defineProperty(new Error('cleanup'), 'code', { get() { throw cleanupDiagnostic; } }));
  const combined = preserveEmbeddingCleanupFailure(primary, cleanup);
  assert.deepEqual(combined.errors, [primary, cleanup, primaryDiagnostic, cleanupDiagnostic]);
  assert.deepEqual(getEmbeddingFailureProvenance(combined).children, [primary, cleanup, primaryDiagnostic, cleanupDiagnostic]);
  assert.equal(combined.cacheOwnershipReleased(), false);
  primarySettled = true; assert.equal(combined.cacheOwnershipReleased(), false);
  cleanupSettled = true; assert.equal(combined.cacheOwnershipReleased(), true);
}

{
  const owner = controlled();
  const original = Object.freeze({ cacheOwnershipPending: true });
  const primary = Object.freeze(Object.defineProperty(new Error('unknown diagnostic'), 'message', { get() { throw original; } }));
  owner.lifetime.recordFailure(owner.entry, primary);
  const failure = await rejected(owner.lifetime.retire(owner.entry));
  await rejected(owner.entry.owner.release());
  assert.equal(owner.closes, 0);
  assert.equal(failure.cacheOwnershipReleased(), false);
  assert.equal(owner.lifetime.retiredOwners()[0], owner.entry.owner);
  // This private negative retains inert unknown ownership; no native resource.
}
console.log('Outer embedding cache diagnostic prerequisite controls authored; execution deferred.');
