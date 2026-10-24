import assert from 'node:assert/strict';
import { createSnapshotRequestQueue } from '../../src/map/isometric/client/data/request-queue.js';
import { getPendingSceneResourceOwners } from '../../src/map/isometric/client/scene-retirement.js';

const flush = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
const outcome = promise => promise.then(value => ({ rejected: false, value }), error => ({ rejected: true, error }));
const contains = (root, expected) => {
  const queue = [root], seen = new Set();
  while (queue.length) {
    const value = queue.pop(); if (Object.is(value, expected)) return true;
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value); if (Object.hasOwn(value, 'cause')) queue.push(value.cause);
    if (Array.isArray(value.errors)) queue.push(...value.errors);
  }
  return false;
};
const signalDouble = () => {
  const listeners = new Set();
  return { aborted: false, reason: undefined, addReads: 0, removeReads: 0, added: 0, removed: 0,
    removalFails: false, removalFailure: null,
    get addEventListener() { this.addReads++; return function(_name, callback) { this.added++; listeners.add(callback); }; },
    get removeEventListener() { this.removeReads++; return function(_name, callback) {
      this.removed++; if (this.removalFails) throw this.removalFailure; listeners.delete(callback);
    }; },
    fire(reason) { this.aborted = true; this.reason = reason; for (const callback of [...listeners]) callback(); }
  };
};
const originalOwner = signal => getPendingSceneResourceOwners().find(owner => owner.resource === signal);

// Outcome presence, rather than error truthiness, decides rejection. Every
// falsey original runner value is preserved exactly and the slot still drains.
for (const original of [undefined, null, false, 0, '']) {
  const queue = createSnapshotRequestQueue({ inFlight: 1, queued: 0 });
  const result = await outcome(queue.request({ lane: 'falsey', run() { throw original; } }));
  assert.equal(result.rejected, true); assert.equal(result.error, original); await flush();
  assert.equal(queue.stats().running, 0); assert.equal(await queue.request({ lane: 'after', run: () => 'after' }), 'after');
  queue.dispose();
}

// The exact original remover and receiver survive later mutation. A throwing
// remover rejects the request, retains its exact resource, and never strands it.
const signal = signalDouble(), queue = createSnapshotRequestQueue();
let complete;
const request = outcome(queue.request({ lane: 'original', signal, run: () => new Promise(resolve => { complete = resolve; }) }));
const removeError = Object.freeze(new Error('original remove failed'));
signal.removalFails = true; signal.removalFailure = removeError;
Object.defineProperties(signal, { addEventListener: { get() { assert.fail('later add method cannot be adopted'); } },
  removeEventListener: { get() { assert.fail('later remove method cannot be adopted'); } } });
complete('value'); const result = await request;
assert.equal(result.rejected, true); assert(contains(result.error, removeError)); await flush(); assert.equal(queue.stats().running, 0);
const owner = originalOwner(signal); assert(owner); assert.equal(signal.removed, 1); assert.equal(signal.addReads, 1); assert.equal(signal.removeReads, 1);
assert.throws(() => owner.retire(), error => contains(error, removeError)); assert.equal(signal.removed, 1);
signal.removalFails = false; owner.release(); assert.equal(signal.removed, 2); owner.release(); assert.equal(signal.removed, 2);
queue.dispose();

// A falsey operation failure and a falsey cleanup failure retain separate exact
// causes; the original operation cannot become a successful undefined result.
const bothSignal = signalDouble(), bothQueue = createSnapshotRequestQueue();
bothSignal.removalFails = true; bothSignal.removalFailure = undefined;
const both = await outcome(bothQueue.request({ lane: 'both', signal: bothSignal, run() { throw false; } }));
assert.equal(both.rejected, true); assert(contains(both.error, false)); assert(contains(both.error, undefined));
bothSignal.removalFails = false; originalOwner(bothSignal).release(); bothQueue.dispose();

// Independent original scene/cache channels gate the initial native removal.
// Successful sibling cleanup and copied owner fields cannot authorize it.
let sceneReleased = false, cacheReleased = false;
const pending = Object.freeze(Object.defineProperties(new Error('original task still owns native work'), {
  sceneOwnershipReleased: { value: () => sceneReleased }, cacheOwnershipReleased: { value: () => cacheReleased }
}));
const blockedSignal = signalDouble(), blockedQueue = createSnapshotRequestQueue();
const blocked = await outcome(blockedQueue.request({ lane: 'blocked', signal: blockedSignal, run() { throw pending; } }));
assert.equal(blocked.rejected, true); assert(contains(blocked.error, pending)); assert.equal(blockedSignal.removed, 0);
const blockedOwner = originalOwner(blockedSignal); sceneReleased = true;
assert.throws(() => blockedOwner.release(), error => contains(error, pending)); assert.equal(blockedSignal.removed, 0);
cacheReleased = true; blockedOwner.release(); assert.equal(blockedSignal.removed, 1); blockedQueue.dispose();
const unknownSignal = signalDouble(), unknownQueue = createSnapshotRequestQueue();
const unknown = Object.freeze(Object.assign(new Error('unknown original task'), { sceneOwnershipPending: true, sceneResourceOwner: blockedOwner }));
await outcome(unknownQueue.request({ lane: 'unknown', signal: unknownSignal, run() { throw unknown; } }));
blockedOwner.release(); assert.throws(() => originalOwner(unknownSignal).release(), error => contains(error, unknown));
assert.equal(unknownSignal.removed, 0); unknownQueue.dispose();

// Failed native removal with pending original work is not retried until that
// exact observation is true, and then only through deliberate reconciliation.
let removalReleased = false;
const removalPending = Object.freeze(Object.defineProperty(new Error('original remover has not returned'),
  'cacheOwnershipReleased', { value: () => removalReleased }));
const retrySignal = signalDouble(), retryQueue = createSnapshotRequestQueue();
retrySignal.removalFails = true; retrySignal.removalFailure = removalPending;
await outcome(retryQueue.request({ lane: 'retry', signal: retrySignal, run: () => 1 }));
const retryOwner = originalOwner(retrySignal); assert.equal(retrySignal.removed, 1);
assert.throws(() => retryOwner.release(), error => contains(error, removalPending)); assert.equal(retrySignal.removed, 1);
removalReleased = true; retrySignal.removalFails = false; retryOwner.release(); assert.equal(retrySignal.removed, 2); retryQueue.dispose();

// External falsey cancellation rejects promptly but cannot free the physical
// slot while the original runner is still accepted and unfinished.
const abortSignal = signalDouble(), abortQueue = createSnapshotRequestQueue({ inFlight: 1, queued: 1 });
let finish, nextStarted = false;
const held = outcome(abortQueue.request({ lane: 'held', signal: abortSignal, run: () => new Promise(resolve => { finish = resolve; }) }));
const next = abortQueue.request({ lane: 'next', run() { nextStarted = true; return 'next'; } });
abortSignal.fire(false); const aborted = await held; assert.equal(aborted.rejected, true); assert.equal(aborted.error, false);
assert.equal(abortQueue.stats().running, 1); assert.equal(nextStarted, false); assert.equal(abortSignal.removed, 1);
finish('late'); await flush(); assert.equal(await next, 'next'); abortQueue.dispose();
for (const reason of [false, null, 0, '']) {
  const abortedSignal = signalDouble(), abortedQueue = createSnapshotRequestQueue(); abortedSignal.aborted = true;
  let reasonReads = 0;
  Object.defineProperty(abortedSignal, 'reason', { get() { reasonReads++; return reason; } });
  const preAborted = await outcome(abortedQueue.request({ lane: 'before', signal: abortedSignal, run() { assert.fail('pre-aborted runner cannot start'); } }));
  assert.equal(preAborted.rejected, true); assert.equal(preAborted.error, reason); assert.equal(reasonReads, 1); abortedQueue.dispose();
}

// A remover getter can retire the queue; no later add getter or runner has
// authority. The exact captured remover is still cleaned after capture returns.
const cutoffQueue = createSnapshotRequestQueue(), cutoffSignal = signalDouble();
Object.defineProperty(cutoffSignal, 'removeEventListener', { get() {
  cutoffQueue.dispose(); return function() { this.removed++; };
} });
Object.defineProperty(cutoffSignal, 'addEventListener', { get() { assert.fail('later add getter cannot run after retirement'); } });
const cutoff = await outcome(cutoffQueue.request({ lane: 'cutoff', signal: cutoffSignal, run() { assert.fail('retired acquisition cannot run'); } }));
assert.equal(cutoff.rejected, true); assert.equal(cutoff.error.name, 'AbortError'); assert.equal(cutoffSignal.removed, 1);

// Installed-then-retired registration can also throw a falsey independent
// failure. Cleanup occurs only after the original registration stack returns.
const partialQueue = createSnapshotRequestQueue(), partialSignal = signalDouble(); let adding = false;
Object.defineProperty(partialSignal, 'addEventListener', { get() { return function() {
  adding = true;
  try { partialQueue.dispose(); throw undefined; } finally { adding = false; }
}; } });
Object.defineProperty(partialSignal, 'removeEventListener', { get() { return function() {
  assert.equal(adding, false); this.removed++;
}; } });
const partial = await outcome(partialQueue.request({ lane: 'partial', signal: partialSignal, run() { assert.fail('partial registration cannot run'); } }));
assert.equal(partial.rejected, true); assert.equal(partial.error.name, 'AbortError'); assert(contains(partial.error, undefined));
assert.equal(partialSignal.removed, 1); assert.equal(partialQueue.stats().running, 0);

const unconfirmedQueue = createSnapshotRequestQueue(), unconfirmedSignal = signalDouble();
Object.defineProperty(unconfirmedSignal, 'addEventListener', { get() { return () => false; } });
const unconfirmed = await outcome(unconfirmedQueue.request({ lane: 'unconfirmed', signal: unconfirmedSignal,
  run() { assert.fail('unconfirmed registration cannot admit native work'); } }));
assert.equal(unconfirmed.rejected, true); assert(contains(unconfirmed.error, false)); assert.equal(unconfirmedSignal.removed, 0);
assert.throws(() => originalOwner(unconfirmedSignal).release()); assert.equal(unconfirmedSignal.removed, 0); unconfirmedQueue.dispose();

// Reentrant registration cannot start unadmitted work or bypass the finite
// running-plus-queued budget while the original getter has not returned.
const admissionQueue = createSnapshotRequestQueue({ inFlight: 1, queued: 1 }), admissionSignal = signalDouble();
let acquisition = false, firstFinish, nested, overflow;
Object.defineProperty(admissionSignal, 'addEventListener', { get() {
  acquisition = true;
  nested = admissionQueue.request({ lane: 'nested', run() { assert.equal(acquisition, false); return 'nested'; } });
  overflow = outcome(admissionQueue.request({ lane: 'overflow', run() { assert.fail('capacity bypass'); } }));
  acquisition = false;
  return function() {};
} });
const admitted = admissionQueue.request({ lane: 'admitted', signal: admissionSignal,
  run: () => new Promise(resolve => { assert.equal(acquisition, false); firstFinish = resolve; }) });
assert.equal((await overflow).rejected, true); assert.equal(admissionQueue.stats().running, 1); assert.equal(admissionQueue.stats().queued, 1);
firstFinish('first'); assert.equal(await admitted, 'first'); assert.equal(await nested, 'nested'); admissionQueue.dispose();

const internalQueue = createSnapshotRequestQueue({ inFlight: 1, queued: 0 }); let internalSignal, internalFinish;
const internal = outcome(internalQueue.request({ lane: 'internal', run: signal => new Promise(resolve => {
  internalSignal = signal; internalFinish = resolve;
}) }));
const originalAbort = AbortController.prototype.abort;
try {
  AbortController.prototype.abort = () => assert.fail('later internal abort method cannot replace the original');
  internalQueue.dispose(); assert.equal(internalSignal.aborted, true); assert.equal((await internal).rejected, true);
} finally { AbortController.prototype.abort = originalAbort; internalFinish(); }
await flush(); assert.equal(internalQueue.stats().running, 0);

console.log('Original snapshot request outcome, registration, cleanup and physical-slot controls authored.');
