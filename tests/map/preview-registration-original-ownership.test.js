import assert from 'node:assert/strict';
import { createMapPreviewLifetime } from '../../tools/analysis/map-preview-lifetime.js';
import { runMapPreview } from '../../tools/analysis/map-iso-preview.js';
import { getPendingSceneResourceOwners } from '../../src/map/isometric/client/scene-retirement.js';

const contains = (error, original, visited = new Set()) => {
  if (Object.is(error, original)) return true;
  if (!error || typeof error !== 'object' || visited.has(error)) return false;
  visited.add(error);
  const cause = Object.getOwnPropertyDescriptor(error, 'cause');
  return (cause && contains(cause.value, original, visited))
    || (Object.getOwnPropertyDescriptor(error, 'errors')?.value || []).some(value => contains(value, original, visited));
};
const sink = { write() {} };
{
  let inAdd = false, calls = 0, listener;
  const controller = new AbortController(), lifetime = createMapPreviewLifetime({ controller });
  const target = {
    removeEventListener(name, original) { assert.equal(this, target); assert.equal(inAdd, false); assert.equal(original, listener); calls++; },
    addEventListener(name, original) {
      listener = original; inAdd = true;
      try { lifetime.close(); assert.equal(calls, 0); }
      finally { inAdd = false; }
    }
  };
  assert.throws(() => lifetime.listen(target, 'abort', () => {}), { name: 'AbortError' });
  target.removeEventListener = () => { throw new Error('replacement remover must not run'); };
  lifetime.finishStartup(); await lifetime.close();
  assert.equal(calls, 1); assert.equal(lifetime.listenerOwners()[0].pending, false);
}
{
  // Registration can install then throw a falsey primary before any input read.
  let installed = null, removals = 0;
  const signal = {
    addEventListener(name, listener) { installed = listener; throw undefined; },
    removeEventListener(name, listener) { assert.equal(this, signal); assert.equal(listener, installed); installed = null; removals++; }
  };
  const error = await runMapPreview({ input: 'unread-registration-fixture.json', 'no-open': true },
    { stdout: sink, stderr: sink, signal }).then(() => assert.fail('registration must fail'), failure => failure);
  assert.equal(error, undefined); assert.equal(removals, 1); assert.equal(installed, null);
}
{
  // The actual runner preserves the original primary and failed cleanup, and
  // retries cannot invoke the remover until both original channels settle.
  let nativeReleased = false, cacheReleased = false, removals = 0, installed, inAdd = false;
  const primary = Object.freeze(new Error('original external abort registration'));
  const cleanup = Object.freeze(Object.defineProperties(new Error('original abort remover failed'), {
    sceneOwnershipReleased: { value: () => nativeReleased }, cacheOwnershipReleased: { value: () => cacheReleased }
  }));
  let failCleanup = true;
  const before = new Set(getPendingSceneResourceOwners());
  const signal = {
    addEventListener(name, listener) {
      installed = listener; inAdd = true;
      try { throw primary; } finally { inAdd = false; }
    },
    removeEventListener(name, listener) {
      assert.equal(inAdd, false); assert.equal(listener, installed); removals++;
      if (failCleanup) throw cleanup;
    }
  };
  const failure = await runMapPreview({ input: 'unread-registration-fixture.json', 'no-open': true },
    { stdout: sink, stderr: sink, signal }).catch(error => error);
  assert.equal(contains(failure, primary), true); assert.equal(contains(failure, cleanup), true);
  assert.equal(removals, 1);
  const pending = getPendingSceneResourceOwners().filter(owner => !before.has(owner));
  const subscription = pending.find(owner => owner.label === 'original map preview abort subscription');
  assert.ok(subscription);
  signal.removeEventListener = () => { throw new Error('sibling remover must not run'); };
  failCleanup = false; nativeReleased = true;
  await assert.rejects(subscription.releaseAsync()); assert.equal(removals, 1);
  cacheReleased = true; await subscription.releaseAsync(); assert.equal(removals, 2);
  for (const owner of pending.filter(owner => owner !== subscription)) await owner.releaseAsync();
}
{
  // A process.once call can also install before throwing. The first signal's
  // successful remover and this original second remover run independently.
  const originalOnce = process.once, originalOff = process.off;
  const primary = Object.freeze(new Error('original process subscription'));
  const installed = new Map(), removed = [];
  process.once = function(name, callback) {
    if (name !== 'SIGINT' && name !== 'SIGTERM') return Reflect.apply(originalOnce, this, [name, callback]);
    installed.set(name, callback); if (name === 'SIGTERM') throw primary; return this;
  };
  process.off = function(name, callback) {
    if (!installed.has(name)) return Reflect.apply(originalOff, this, [name, callback]);
    assert.equal(callback, installed.get(name)); installed.delete(name); removed.push(name); return this;
  };
  try {
    const failure = await runMapPreview({ input: 'unread-registration-fixture.json', 'no-open': true },
      { stdout: sink, stderr: sink }).catch(error => error);
    assert.equal(failure, primary); assert.deepEqual(removed, ['SIGINT', 'SIGTERM']); assert.equal(installed.size, 0);
  } finally { process.once = originalOnce; process.off = originalOff; }
}
console.log('Preview original abort/process registration failures and independent cleanup controls passed.');
