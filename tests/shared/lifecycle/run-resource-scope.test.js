import assert from 'node:assert/strict';
import { createRunResourceScope, currentRunResourceScope } from '../../../src/shared/lifecycle/run-scope.js';
import { createRunSharedResources } from '../../../src/shared/lifecycle/shared-resource.js';
import { trackedSubprocessScopeContext, withTrackedSubprocessSignalScope } from '../../../src/shared/subprocess/tracking.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
{
  const scopes = [createRunResourceScope(), createRunResourceScope()];
  let creates = 0, closes = 0;
  const inventory = createRunSharedResources({ create: async () => {
    creates++;
    assert.equal(currentRunResourceScope(), null, 'a shared cache must not inherit its first run capability');
    assert.match(trackedSubprocessScopeContext.getStore()?.ownershipId, /^shared-resource:/);
    return {};
  }, dispose: async () => { closes++; } });
  const first = await scopes[0].run(() => withTrackedSubprocessSignalScope(null, 'file:creator:',
    () => inventory.acquire(scopes[0], 'policy', {})));
  const second = await inventory.acquire(scopes[1], 'policy', {});
  assert.equal(first, second); assert.equal(creates, 1);
  await first.run(() => {
    assert.equal(currentRunResourceScope(), null);
    assert.match(trackedSubprocessScopeContext.getStore()?.ownershipId, /^shared-resource:/);
  });
  await scopes[0].close(); assert.equal(closes, 0); assert.equal(scopes[0].isSettled(), true);
  const held = Promise.withResolvers(), entered = Promise.withResolvers();
  const work = scopes[1].track(async () => {
    assert.equal(currentRunResourceScope(), scopes[1]); entered.resolve(); await held.promise;
  });
  await entered.promise;
  let closed = false; const closing = scopes[1].close().then(() => { closed = true; });
  await tick(); assert.equal(closed, false); assert.equal(closes, 0);
  await assert.rejects(scopes[1].track(() => { throw new Error('late work must never run'); }), { code: 'ABORT_ERR' });
  held.resolve(); await work; await closing;
  assert.equal(closes, 1); assert.equal(scopes[0].isSettled(), true);
  await inventory.shutdownAll(); assert.equal(closes, 1, 'global observation cannot repeat a confirmed close');
}
{
  const scope = createRunResourceScope(), started = Promise.withResolvers(), finish = Promise.withResolvers();
  let closes = 0;
  const inventory = createRunSharedResources({ create: async () => { started.resolve(); await finish.promise; return {}; },
    dispose: async () => { closes++; } });
  const creating = inventory.acquire(scope, 'pending-creation', {});
  creating.catch(() => {}); await started.promise;
  let closed = false; const closing = scope.close().then(() => { closed = true; });
  await tick(); assert.equal(closed, false);
  finish.resolve(); await assert.rejects(creating, { code: 'ABORT_ERR' }); await closing;
  assert.equal(closes, 1); assert.equal(scope.isSettled(), true);
}
{
  const scope = createRunResourceScope();
  let settled = false, closes = 0;
  const original = Object.assign(new Error('original pending native work'), {
    cacheOwnershipPending: true, cacheOwnershipReleased: () => settled
  });
  const inventory = createRunSharedResources({ create: async () => ({}), dispose: async () => { closes++; } });
  await inventory.acquire(scope, 'pending-work', {});
  await assert.rejects(scope.track(async () => { throw original; }), error => error === original);
  original.cacheOwnershipPending = false; original.cacheOwnershipReleased = () => true;
  let failure; try { await scope.close(); } catch (error) { failure = error; }
  assert.ok(failure); assert.equal(failure.cacheOwnershipReleased(), false); assert.equal(closes, 1);
  settled = true; assert.equal(failure.cacheOwnershipReleased(), true);
  await assert.rejects(scope.close(), error => error === failure, 'settlement never rewrites the original close failure');
  assert.equal(closes, 1);
}
{
  const scope = createRunResourceScope(), entered = Promise.withResolvers(), release = Promise.withResolvers();
  let resourceClosed = false;
  const work = scope.track(async () => {
    entered.resolve(); await release.promise;
    scope.adopt('accepted-late-creation', { release: async () => { resourceClosed = true; }, isSettled: () => resourceClosed });
  });
  await entered.promise;
  const closing = scope.close(); release.resolve(); await work; await closing;
  assert.equal(resourceClosed, true);
  assert.throws(() => scope.adopt('unowned-late-creation', { release() {}, isSettled: () => true }), { code: 'ABORT_ERR' });
}
{
  const scope = createRunResourceScope();
  let disposed = false, creates = 0, closes = 0;
  const original = new Error('original native disposal failed before its completion');
  const inventory = createRunSharedResources({ create: async () => { creates++; return {}; },
    dispose: async () => { if (++closes === 1) throw original; }, isDisposed: () => disposed });
  await inventory.acquire(scope, 'native-disposal', {});
  let failure; try { await scope.close(); } catch (error) { failure = error; }
  assert.ok(failure); assert.equal(failure.cacheOwnershipReleased(), false);
  const next = createRunResourceScope();
  await assert.rejects(inventory.acquire(next, 'native-disposal', {}));
  assert.equal(creates, 1); assert.equal(closes, 1, 'a failed waiter cannot repeat original native disposal');
  disposed = true;
  assert.equal(failure.cacheOwnershipReleased(), true, 'only the actual component completion releases ownership');
  await inventory.acquire(next, 'native-disposal', {});
  assert.equal(creates, 2, 'a new explicit acquisition can replace the confirmed retired component');
  await next.close();
  await assert.rejects(scope.close(), error => error === failure);
}
{
  const scope = createRunResourceScope();
  let settled = false, creates = 0;
  const original = Object.assign(new Error('original creation still owns native work'), {
    cacheOwnershipPending: true, cacheOwnershipReleased: () => settled
  });
  const inventory = createRunSharedResources({ create: async () => {
    if (++creates === 1) throw original;
    return {};
  }, dispose: async () => {} });
  await assert.rejects(inventory.acquire(scope, 'creation', {}), error => error === original);
  await assert.rejects(scope.close());
  const next = createRunResourceScope();
  await assert.rejects(inventory.acquire(next, 'creation', {}));
  assert.equal(creates, 1);
  settled = true; await inventory.acquire(next, 'creation', {}); await next.close();
  assert.equal(creates, 2);
}
console.log('Run scopes fence admission, retain original failures and late accepted resources, and release only their shared-cache references.');
