import assert from 'node:assert/strict';
import { createMapPreviewLifetime } from '../../tools/analysis/map-preview-lifetime.js';

const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const turn = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const chainIncludes = (value, wanted, visited = new Set()) => {
  if (Object.is(value, wanted)) return true;
  if (!value || typeof value !== 'object' || visited.has(value)) return false;
  visited.add(value);
  return chainIncludes(value.cause, wanted, visited) || (value.errors || []).some(error => chainIncludes(error, wanted, visited));
};
const fixture = ({ listenerError = null, forceError = null, detach = () => {} } = {}) => {
  const controller = new AbortController(), lifetime = createMapPreviewLifetime({ controller, detach });
  const calls = { close: 0, force: 0, pins: 0, document: 0 };
  let closeError = listenerError, disconnectError = forceError;
  const server = {
    close(callback) { assert.equal(this, server); calls.close++; callback(closeError); },
    closeAllConnections() { assert.equal(this, server); calls.force++; if (disconnectError !== null) throw disconnectError; }
  };
  const listener = lifetime.ownServer(server);
  const pins = lifetime.adopt({ dispose() { calls.pins++; } }, 'test pinned bytes');
  const document = lifetime.adopt({ dispose() { calls.document++; } }, 'test document bytes');
  return { controller, lifetime, calls, server, listener, pins, document,
    setCloseError(value) { closeError = value; }, setForceError(value) { disconnectError = value; } };
};

{
  const f = fixture();
  const close = f.lifetime.close();
  assert.equal(f.lifetime.close(), close, 'all callers observe one original close flight');
  let reentered;
  f.controller.signal.addEventListener('abort', () => { reentered = f.lifetime.close(); }, { once: true });
  await turn();
  assert.equal(reentered, close, 'abort reentry observes the already-published close flight');
  assert.deepEqual(f.calls, { close: 0, force: 0, pins: 0, document: 0 }, 'retirement waits for original startup acquisition');
  f.server.close = f.server.closeAllConnections = () => { throw new Error('replacement must not run'); };
  const late = { calls: 0, dispose() { this.calls++; } };
  f.lifetime.adopt(late, 'late original acquisition');
  f.lifetime.finishStartup();
  await close;
  assert.equal(late.calls, 1);
  assert.deepEqual(f.calls, { close: 1, force: 1, pins: 1, document: 1 });
  assert.equal(f.lifetime.resourceOwner.pending, false);
  assert.throws(() => f.lifetime.adopt({ dispose() {} }, 'unrelated later acquisition'), /original startup/);
}
{
  const f = fixture(), work = gate(), entered = gate();
  const request = f.lifetime.request(async () => { entered.resolve(); await work.promise; return 'original response'; });
  await entered.promise;
  f.lifetime.finishStartup();
  const close = f.lifetime.close();
  await turn();
  assert.equal(f.calls.close, 1);
  assert.equal(f.calls.pins, 0, 'listener cancellation does not prove accepted asynchronous handlers returned');
  let replacement = 0;
  await assert.rejects(f.lifetime.request(() => { replacement++; }), { name: 'AbortError' });
  assert.equal(replacement, 0);
  work.resolve();
  assert.equal(await request, 'original response');
  await close;
  assert.equal(f.calls.pins, 1);
}
{
  const original = Object.freeze(new Error('original listener close failed'));
  const f = fixture({ listenerError: original });
  f.lifetime.finishStartup();
  const close = f.lifetime.close();
  await assert.rejects(close, error => chainIncludes(error, original));
  assert.equal(f.lifetime.close(), close);
  assert.equal(f.calls.pins, 0, 'failed original native closure keeps pinned bytes retained');
  await assert.rejects(f.lifetime.resourceOwner.releaseAsync(), error => chainIncludes(error, original));
  assert.equal(f.calls.close, 1, 'parent reconciliation cannot repeat a failed original child disposal');
  f.setCloseError(null);
  await f.listener.releaseAsync();
  assert.equal(f.calls.force, 1, 'a fulfilled original connection cancellation is never repeated');
  await f.pins.releaseAsync(); await f.document.releaseAsync();
  await f.lifetime.resourceOwner.releaseAsync();
  assert.equal(f.calls.close, 2);
  assert.equal(f.lifetime.resourceOwner.pending, false);
}
{
  let settled = false;
  const independent = Object.freeze(Object.defineProperty(new Error('original native work remains pending'),
    'sceneOwnershipReleased', { value: () => settled }));
  const f = fixture({ forceError: independent });
  f.lifetime.finishStartup();
  await assert.rejects(f.lifetime.close(), error => chainIncludes(error, independent));
  f.setForceError(null);
  await assert.rejects(f.listener.releaseAsync(), error => chainIncludes(error, independent));
  assert.equal(f.calls.force, 1, 'explicit retries still wait for the original pending-work observer');
  assert.equal(f.calls.close, 1, 'successful callback evidence remains fulfilled');
  settled = true;
  await f.listener.releaseAsync();
  await f.pins.releaseAsync(); await f.document.releaseAsync();
  await f.lifetime.resourceOwner.releaseAsync();
  assert.equal(f.calls.force, 2);
  assert.equal(f.calls.close, 1);
}
{
  const primary = Object.freeze(new Error('detach failed'));
  const f = fixture({ detach() { throw primary; } });
  f.lifetime.finishStartup();
  await assert.rejects(f.lifetime.close(), error => chainIncludes(error, primary));
  assert.deepEqual(f.calls, { close: 1, force: 1, pins: 1, document: 1 }, 'independent detach failure cannot suppress actual owned cleanup');
  await f.lifetime.resourceOwner.releaseAsync();
  assert.deepEqual(f.calls, { close: 1, force: 1, pins: 1, document: 1 }, 'reconciliation preserves all fulfilled disposal evidence');
}
console.log('Preview close retains original listener, startup and accepted-request ownership.');
