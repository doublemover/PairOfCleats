import assert from 'node:assert/strict';
import { readBoundedJson } from '../../src/map/workspace/request.js';
import { readBoundedJsonResponse } from '../../src/map/isometric/client/data/protocol.js';
import { getPendingSceneResourceOwners } from '../../src/map/isometric/client/scene-retirement.js';

const outcome = promise => promise.then(value => ({ ok: true, value }), error => ({ ok: false, error }));
const contains = (root, wanted, visited = new Set()) => {
  if (Object.is(root, wanted)) return true;
  if (!root || typeof root !== 'object' || visited.has(root)) return false;
  visited.add(root);
  return contains(root.cause, wanted, visited) || (root.errors || []).some(value => contains(value, wanted, visited));
};
const fixture = ({ text = '{"value":"original"}', readFailure, failRead = false, cancelFailure, failCancel = false,
  lockFailure, failLock = false, status = 200, contentType = 'application/json' } = {}) => {
  const bytes = new TextEncoder().encode(text);
  const state = { reads: 0, cancellations: 0, releases: 0, failRead, readFailure, failCancel, cancelFailure, failLock, lockFailure };
  const reader = {
    async read() { assert.equal(this, reader); state.reads++; if (state.failRead) throw state.readFailure; return state.reads === 1 ? { done: false, value: bytes } : { done: true }; },
    async cancel() { assert.equal(this, reader); state.cancellations++; if (state.failCancel) throw state.cancelFailure; },
    releaseLock() { assert.equal(this, reader); state.releases++; if (state.failLock) throw state.lockFailure; }
  };
  const body = { getReader() { assert.equal(this, body); return reader; } };
  return { reader, state, bytes, response: { ok: status >= 200 && status < 300, status, body, headers: { get: () => contentType } } };
};
const readers = [
  ['workspace', (response, options = {}) => readBoundedJson(response, options.maxBytes || 1024, options)],
  ['snapshot', (response, options = {}) => readBoundedJsonResponse(response, { maxBytes: 1024, ...options })]
];
for (const [name, read] of readers) {
  const good = fixture();
  assert.deepEqual(await read(good.response), { value: 'original' });
  assert.equal(good.state.cancellations, 1); assert.equal(good.state.releases, 1);
  for (const primary of [undefined, null, false, 0, '', Object.freeze(new Error('original read failed'))]) {
    const cancelFailure = Object.freeze(new Error('original cancellation failed')), lockFailure = Object.freeze(new Error('original lock release failed'));
    const f = fixture({ readFailure: primary, failRead: true, failCancel: true, cancelFailure, failLock: true, lockFailure });
    const result = await outcome(read(f.response));
    assert.equal(result.ok, false, name); assert.equal(result.error.cause, primary);
    assert(contains(result.error, cancelFailure)); assert(contains(result.error, lockFailure));
    assert.equal(f.state.cancellations, 1); assert.equal(f.state.releases, 1, 'ordinary cancellation rejection cannot suppress independent lock cleanup');
    f.reader.cancel = f.reader.releaseLock = () => assert.fail('replacement method has no original reader authority');
    f.state.failCancel = false; f.state.failLock = false;
    for (const owner of getPendingSceneResourceOwners().filter(owner => owner.resource === f.reader)) await owner.releaseAsync();
    assert.equal(f.state.cancellations, 2); assert.equal(f.state.releases, 2);
  }
  const syntaxCleanup = Object.freeze(new Error('cleanup after parse failed'));
  const malformed = fixture({ text: '{', failCancel: true, cancelFailure: syntaxCleanup });
  const syntax = await outcome(read(malformed.response));
  assert.equal(syntax.ok, false); assert(syntax.error.cause instanceof SyntaxError); assert(contains(syntax.error, syntaxCleanup));
  malformed.state.failCancel = false;
  for (const owner of getPendingSceneResourceOwners().filter(owner => owner.resource === malformed.reader)) await owner.releaseAsync();
  const budget = fixture({ text: '{"long":"over budget"}' });
  await assert.rejects(read(budget.response, { maxBytes: 4 }), /admission|byte budget/);
  assert.equal(budget.state.releases, 1);
  const invalidUtf8 = fixture(); invalidUtf8.bytes.fill(255);
  await assert.rejects(read(invalidUtf8.response)); assert.equal(invalidUtf8.state.releases, 1);
  const cancelled = fixture(), controller = new AbortController(); controller.abort(false);
  const aborted = await outcome(read(cancelled.response, { signal: controller.signal }));
  assert.equal(aborted.ok, false); assert.equal(aborted.error, false);
  assert.equal(cancelled.state.reads, 0); assert.equal(cancelled.state.cancellations, 1); assert.equal(cancelled.state.releases, 1, 'an already received stale response still releases its original body');
  const denied = fixture({ status: 409, text: '{"error":"original generation conflict"}' });
  await assert.rejects(read(denied.response), /409|generation conflict/); assert.equal(denied.state.releases, 1);
}
{
  let sceneDone = false, cacheDone = false;
  const original = Object.freeze(Object.defineProperties(new Error('original cancellation still owns native work'), {
    sceneOwnershipReleased: { value: () => sceneDone }, cacheOwnershipReleased: { value: () => cacheDone }
  }));
  const f = fixture({ failCancel: true, cancelFailure: original });
  const result = await outcome(readBoundedJsonResponse(f.response));
  assert.equal(result.ok, false); assert(contains(result.error, original));
  assert.equal(f.state.releases, 0, 'lock release waits for independent original cancel work');
  const owners = getPendingSceneResourceOwners().filter(owner => owner.resource === f.reader);
  sceneDone = true;
  for (const owner of owners) await assert.rejects(owner.releaseAsync());
  assert.equal(f.state.cancellations, 1); assert.equal(f.state.releases, 0);
  cacheDone = true; f.state.failCancel = false;
  for (const owner of owners) await owner.releaseAsync();
  assert.equal(f.state.cancellations, 2); assert.equal(f.state.releases, 1);
}
{
  const f = fixture(), expected = f.bytes.slice();
  let reads = 0;
  f.reader.read = async () => {
    if (!reads++) return { done: false, value: f.bytes };
    f.bytes.fill(0); return { done: true };
  };
  assert.deepEqual(await readBoundedJson(f.response), JSON.parse(new TextDecoder().decode(expected)), 'later buffer reuse cannot mutate previously admitted bytes');
}
{
  const f = fixture(), controller = new AbortController(); let finish;
  f.reader.read = () => new Promise(resolve => { finish = resolve; });
  const reading = outcome(readBoundedJsonResponse(f.response, { signal: controller.signal }));
  controller.abort(0);
  assert.equal(f.state.cancellations, 0, 'original accepted read has not returned');
  finish({ done: false, value: f.bytes });
  const result = await reading; assert.equal(result.ok, false); assert.equal(result.error, 0);
  assert.equal(f.state.cancellations, 1); assert.equal(f.state.releases, 1);
}
{
  const f = fixture(), accepted = []; let entered;
  const secondRead = new Promise(resolve => { entered = resolve; });
  f.reader.read = function() { assert.equal(this, f.reader); f.state.reads++; return new Promise(resolve => {
    accepted.push(resolve); if (accepted.length === 2) entered();
  }); };
  const reading = outcome(readBoundedJsonResponse(f.response));
  f.reader.cancel = f.reader.releaseLock = () => assert.fail('later cleanup methods cannot replace originals');
  f.reader.read = () => assert.fail('later read method cannot replace the original');
  accepted[0]({ done: false, value: f.bytes }); await secondRead;
  accepted[1]({ done: true });
  assert.equal((await reading).ok, true); assert.equal(f.state.cancellations, 1); assert.equal(f.state.releases, 1);
}
{
  let adopted = 0;
  const unknown = Object.freeze(Object.assign(new Error('unknown original read work'), {
    sceneOwnershipPending: true, sceneResourceOwner: { release() { adopted++; } }
  }));
  const f = fixture({ failRead: true, readFailure: unknown });
  const result = await outcome(readBoundedJsonResponse(f.response));
  assert.equal(result.ok, false); assert(contains(result.error, unknown));
  for (const owner of getPendingSceneResourceOwners().filter(owner => owner.resource === f.reader)) await assert.rejects(owner.releaseAsync());
  assert.equal(adopted, 0); assert.equal(f.state.cancellations, 0); assert.equal(f.state.releases, 0, 'lookalike fields cannot settle an unknown original prerequisite');
}
{
  const f = fixture({ contentType: 'text/html' });
  await assert.rejects(readBoundedJsonResponse(f.response), /requires JSON/);
  assert.equal(f.state.reads, 0); assert.equal(f.state.cancellations, 1); assert.equal(f.state.releases, 1);
}
console.log('Actual map JSON readers retain original read, parse, cancel and lock-release outcomes.');
