import assert from 'node:assert/strict';
import { createGraphWorkerClient } from '../../src/map/isometric/client/data/worker-client.js';
import { MAP_DATA_PROTOCOL } from '../../src/map/isometric/client/data/protocol.js';
import { getPendingSceneResourceOwners } from '../../src/map/isometric/client/scene-retirement.js';

const all = [];
class WorkerDouble {
  constructor() { this.sent = []; this.closed = 0; this.postReads = 0; this.closeReads = 0; all.push(this); }
  get postMessage() {
    this.postReads++;
    return function(message) {
      this.sent.push(message);
      if (this.postFailure && message.kind === this.postFailure.kind) throw this.postFailure.error;
      if (message.kind === 'init') queueMicrotask(() => this.onmessage({ data: { ...message, event: 'ready', manifest: 'original manifest' } }));
    };
  }
  get terminate() {
    this.closeReads++;
    return function() { this.closed++; if (this.closeFailure) throw this.closeFailure; };
  }
  reply(request, value) { this.onmessage({ data: { protocol: MAP_DATA_PROTOCOL, snapshot: request.snapshot,
    request: request.request, revision: request.revision, kind: request.kind, event: 'result', value } }); }
}
const create = options => createGraphWorkerClient({ snapshot: 'source:a', endpoint: '/snapshot', token: 'fixture',
  WorkerImpl: WorkerDouble, ...options });
const flush = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
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

// The ordinary transport remains concurrent and carries the full original init
// publication; disposal uses captured methods even after native fields change.
let progress;
const ordinary = create({ onProgress: value => { progress = value; } });
await flush(); const original = all.at(-1);
assert.equal(progress.manifest, 'original manifest'); assert.equal(ordinary.ready, true);
assert.equal(ordinary.resourceOwner, null, 'the client exposes reconciliation only after its retirement');
const request = ordinary.request('detail', {}, { lane: 'original panel' });
original.reply(original.sent.at(-1), 'original result'); assert.equal(await request, 'original result');
Object.defineProperties(original, { postMessage: { get() { assert.fail('later post getter cannot replace original method'); } },
  terminate: { get() { assert.fail('later close getter cannot replace original method'); } } });
ordinary.dispose(); assert.equal(original.closed, 1); ordinary.dispose(); assert.equal(original.closed, 1);
assert.equal(original.postReads, 1); assert.equal(original.closeReads, 1);

// A failing dispose post cannot skip request settlement or the independent
// original close. A failed close remains strongly retained and never auto-retries.
const closeError = Object.freeze(new Error('original termination failed'));
const postError = Object.freeze(new Error('original dispose post failed'));
let notified = 0;
const failed = create({ onFailure() { notified++; } }); await flush(); const failedWorker = all.at(-1);
failedWorker.postFailure = { kind: 'dispose', error: postError }; failedWorker.closeFailure = closeError;
const runningOne = failed.request('detail', {}, { lane: 'one' }).catch(error => error);
const runningTwo = failed.request('detail', {}, { lane: 'two' }).catch(error => error);
const queued = failed.request('detail', {}, { lane: 'three' }).catch(error => error);
assert.throws(() => failed.dispose(), error => contains(error, postError) && contains(error, closeError));
assert.equal((await runningOne).name, 'AbortError'); assert.equal((await runningTwo).name, 'AbortError');
assert.equal((await queued).name, 'AbortError'); await flush();
assert.equal(failed.stats().running, 0); assert.equal(failed.stats().queued, 0); assert.equal(notified, 1);
assert.equal(failedWorker.closed, 1); assert(getPendingSceneResourceOwners().includes(failed.resourceOwner));
assert.throws(() => failed.dispose(), error => contains(error, closeError)); assert.equal(failedWorker.closed, 1);
failedWorker.closeFailure = null;
failed.resourceOwner.release(); assert.equal(failedWorker.closed, 2); assert.equal(failed.resourceOwner.pending, false);
failed.resourceOwner.release(); assert.equal(failedWorker.closed, 2, 'successful original termination is retained');
assert.equal(failedWorker.sent.filter(message => message.kind === 'dispose').length, 1, 'explicit native close reconciliation never replays transport');

// Original independent native-work evidence gates termination before its first
// call, including through composed diagnostics; copied fields do not authorize it.
let released = false;
const blocker = Object.freeze(Object.defineProperties(new Error('original post still owns native work'), {
  cacheOwnershipPending: { value: true }, cacheOwnershipReleased: { value: () => released }
}));
const blocked = create(); await flush(); const blockedWorker = all.at(-1);
blockedWorker.postFailure = { kind: 'dispose', error: blocker };
assert.throws(() => blocked.dispose(), error => contains(error, blocker)); assert.equal(blockedWorker.closed, 0);
assert.throws(() => blocked.resourceOwner.release(), error => contains(error, blocker)); assert.equal(blockedWorker.closed, 0);
const sibling = create(); await flush(); const siblingWorker = all.at(-1);
sibling.dispose(); assert.equal(siblingWorker.closed, 1); assert.equal(blockedWorker.closed, 0);
released = true; blocked.resourceOwner.release(); assert.equal(blockedWorker.closed, 1);

const lookalike = Object.freeze(Object.defineProperties(new Error('copied sibling is no original proof'), {
  sceneResourceOwner: { value: sibling.resourceOwner }, sceneOwnershipPending: { value: true }
}));
const unknown = create(); await flush(); const unknownWorker = all.at(-1);
unknownWorker.postFailure = { kind: 'dispose', error: lookalike };
assert.throws(() => unknown.dispose(), error => contains(error, lookalike)); assert.equal(unknownWorker.closed, 0);
sibling.resourceOwner.release();
assert.throws(() => unknown.resourceOwner.release(), error => contains(error, lookalike)); assert.equal(unknownWorker.closed, 0);

let sceneReleased = false, cacheReleased = false;
const dual = Object.freeze(Object.defineProperties(new Error('independent original channels'), {
  sceneOwnershipReleased: { value: () => sceneReleased }, cacheOwnershipReleased: { value: () => cacheReleased }
}));
const dualClient = create(); await flush(); const dualWorker = all.at(-1); dualWorker.closeFailure = dual;
assert.throws(() => dualClient.dispose(), error => contains(error, dual)); assert.equal(dualWorker.closed, 1);
sceneReleased = true;
assert.throws(() => dualClient.resourceOwner.release(), error => contains(error, dual)); assert.equal(dualWorker.closed, 1);
cacheReleased = true; dualWorker.closeFailure = null;
dualClient.resourceOwner.release(); assert.equal(dualWorker.closed, 2);

let notificationReleased = false;
const notification = Object.freeze(Object.defineProperty(new Error('notification still owns original work'),
  'cacheOwnershipReleased', { value: () => notificationReleased }));
const fulfilled = create({ onFailure() { throw notification; } }); await flush(); const fulfilledWorker = all.at(-1);
assert.throws(() => fulfilled.dispose(), error => contains(error, notification)); assert.equal(fulfilledWorker.closed, 1);
assert.throws(() => fulfilled.resourceOwner.release(), error => contains(error, notification)); assert.equal(fulfilledWorker.closed, 1);
notificationReleased = true; fulfilled.resourceOwner.release(); assert.equal(fulfilledWorker.closed, 1, 'original fulfilled termination is never replayed for independent notification work');

// Failed cancellation posts settle dispatch and retire the client. New native
// queries must not accumulate behind an unconfirmed original cancellation.
const cancellation = create(); await flush(); const cancellationWorker = all.at(-1);
cancellationWorker.postFailure = { kind: 'cancel', error: postError };
const controller = new AbortController();
const cancelled = cancellation.request('detail', {}, { signal: controller.signal }).catch(error => error);
controller.abort(); assert.equal((await cancelled).name, 'AbortError'); await flush(); assert.equal(cancellation.stats().running, 0);
const postsAfterCancellation = cancellationWorker.sent.length;
assert.equal(cancellation.ready, false); assert.equal(cancellationWorker.closed, 1);
await assert.rejects(cancellation.request('detail', {}, { lane: 'next' }), /retired|not ready/);
assert.equal(cancellationWorker.sent.length, postsAfterCancellation); cancellation.dispose();

const pendingCancellation = create(); await flush(); const pendingCancellationWorker = all.at(-1);
let cancelReleased = false;
const pendingCancelError = Object.freeze(Object.defineProperty(new Error('original cancel post still pending'),
  'cacheOwnershipReleased', { value: () => cancelReleased }));
pendingCancellationWorker.postFailure = { kind: 'cancel', error: pendingCancelError };
const superseded = pendingCancellation.request('search', { query: 'original' }).catch(error => error);
const replacement = pendingCancellation.request('search', { query: 'replacement' }).catch(error => error);
assert.equal((await superseded).name, 'AbortError'); await replacement; await flush();
assert.equal(pendingCancellation.ready, false); assert.equal(pendingCancellationWorker.closed, 0);
assert.equal(pendingCancellationWorker.sent.filter(message => message.kind === 'search').length, 1);
const pendingPosts = pendingCancellationWorker.sent.length;
await assert.rejects(pendingCancellation.request('search', { query: 'again' }), /retired|not ready/);
assert.equal(pendingCancellationWorker.sent.length, pendingPosts);
assert.throws(() => pendingCancellation.resourceOwner.release(), error => contains(error, pendingCancelError));
assert.equal(pendingCancellationWorker.closed, 0); cancelReleased = true;
pendingCancellation.resourceOwner.release(); assert.equal(pendingCancellationWorker.closed, 1);

const successfulCancellation = create(); await flush(); const successfulWorker = all.at(-1);
const successfulController = new AbortController();
const successfulAbort = successfulCancellation.request('detail', {}, { signal: successfulController.signal }).catch(error => error);
successfulController.abort(); assert.equal((await successfulAbort).name, 'AbortError'); await flush();
const next = successfulCancellation.request('detail', {}, { lane: 'next' });
successfulWorker.reply(successfulWorker.sent.at(-1), 'next'); assert.equal(await next, 'next'); successfulCancellation.dispose();

// A query post can accept its message and then throw. Dispatch settlement is
// independent, but the original client must retire before another native post.
const posting = create(); await flush(); const postingWorker = all.at(-1);
const originalPending = posting.request('detail', {}, { lane: 'original pending' }).catch(error => error);
const originalMessage = postingWorker.sent.at(-1);
postingWorker.postFailure = { kind: 'search', error: postError }; postingWorker.closeFailure = closeError;
const postingFailure = await posting.request('search', { query: 'accepted before throw' }).catch(error => error);
assert(contains(postingFailure, postError)); assert(contains(await originalPending, postError));
assert.equal(posting.ready, false); assert.equal(postingWorker.closed, 1);
assert(contains(posting.failure, postError)); assert(contains(posting.failure, closeError));
const postingCount = postingWorker.sent.length;
postingWorker.reply(originalMessage, 'obsolete completion');
await assert.rejects(posting.request('search', { query: 'forbidden replacement' }), /retired|not ready/);
assert.equal(postingWorker.sent.length, postingCount);
postingWorker.closeFailure = null; posting.resourceOwner.release(); assert.equal(postingWorker.closed, 2);
await assert.rejects(posting.request('search', { query: 'no implicit reactivation' }), /retired|not ready/);

let querySceneReleased = false, queryCacheReleased = false;
const queryBlocker = Object.freeze(Object.defineProperties(new Error('original query post still owns native work'), {
  sceneOwnershipReleased: { value: () => querySceneReleased }, cacheOwnershipReleased: { value: () => queryCacheReleased }
}));
const blockedPost = create(); await flush(); const blockedPostWorker = all.at(-1);
blockedPostWorker.postFailure = { kind: 'detail', error: queryBlocker };
assert(contains(await blockedPost.request('detail', {}).catch(error => error), queryBlocker));
assert.equal(blockedPost.ready, false); assert.equal(blockedPostWorker.closed, 0);
const blockedPostCount = blockedPostWorker.sent.length;
await assert.rejects(blockedPost.request('detail', {}), /retired|not ready/);
assert.equal(blockedPostWorker.sent.length, blockedPostCount);
querySceneReleased = true;
assert.throws(() => blockedPost.resourceOwner.release(), error => contains(error, queryBlocker)); assert.equal(blockedPostWorker.closed, 0);
queryCacheReleased = true; blockedPost.resourceOwner.release(); assert.equal(blockedPostWorker.closed, 1);
const falseyPost = create(); await flush(); const falseyPostWorker = all.at(-1);
falseyPostWorker.postFailure = { kind: 'detail', error: undefined };
assert(contains(await falseyPost.request('detail', {}).catch(error => error), undefined));
assert.equal(falseyPost.ready, false); assert.equal(falseyPostWorker.closed, 1);

// A falsey original progress failure cannot turn accepted requests into success.
let progressFails = false;
const falsey = create({ onProgress() { if (progressFails) throw undefined; } }); await flush(); const falseyWorker = all.at(-1);
const falseyPending = falsey.request('detail', {}).then(() => assert.fail('falsey failure cannot resolve a query'), error => error);
progressFails = true;
falseyWorker.onmessage({ data: { protocol: MAP_DATA_PROTOCOL, snapshot: 'source:a', kind: 'init', event: 'progress' } });
assert(contains(await falseyPending, undefined)); assert.equal(falseyWorker.closed, 1); await flush(); assert.equal(falsey.stats().running, 0);

// Prevent-default failure remains independent beside the primary crash, and
// malformed result getters cannot remove a dispatch before its promise settles.
const crash = create(); await flush(); const crashWorker = all.at(-1);
const crashPending = crash.request('detail', {}).catch(error => error);
crashWorker.onerror({ message: 'original worker crash', preventDefault() { throw false; } });
const crashResult = await crashPending; assert.equal(crashResult.message, 'original worker crash'); assert(contains(crash.failure, false));
assert.equal(crashWorker.closed, 1);
const malformed = create(); await flush(); const malformedWorker = all.at(-1);
const malformedPending = malformed.request('detail', {}).catch(error => error), sent = malformedWorker.sent.at(-1);
const getterError = Object.freeze(new Error('result capture failed'));
malformedWorker.onmessage({ data: { ...sent, event: 'result', get value() { throw getterError; } } });
assert(contains(await malformedPending, getterError)); await flush(); assert.equal(malformed.stats().running, 0);

// Reentrant disposal cannot invoke the native close while its original accepted
// callback is still running. Reconciliation remains exact and deliberate.
let reentrantClient, reentrantError, reentrant = false;
reentrantClient = create({ onProgress() { if (reentrant) try { reentrantClient.dispose(); } catch (error) { reentrantError = error; } } });
await flush(); const reentrantWorker = all.at(-1); reentrant = true;
reentrantWorker.onmessage({ data: { protocol: MAP_DATA_PROTOCOL, snapshot: 'source:a', kind: 'init', event: 'progress' } });
assert(reentrantError); assert.equal(reentrantWorker.closed, 0);
reentrantClient.resourceOwner.release(); assert.equal(reentrantWorker.closed, 1);

// Partial method acquisition preserves falsey original failure and still
// attempts the separately captured native close. No post getter is retried.
class PartialPost extends WorkerDouble {
  get postMessage() { this.postReads++; throw undefined; }
}
assert.throws(() => create({ WorkerImpl: PartialPost }), error => Object.hasOwn(error, 'cause') && error.cause === undefined);
const partial = all.at(-1); assert.equal(partial.closed, 1); assert.equal(partial.postReads, 1); assert.equal(partial.closeReads, 1);

let startupReleased = false;
const startupError = Object.freeze(Object.defineProperty(new Error('original startup still owns work'),
  'cacheOwnershipReleased', { value: () => startupReleased }));
class PendingStartup extends WorkerDouble {
  get postMessage() { this.postReads++; return function() { throw startupError; }; }
}
assert.throws(() => create({ WorkerImpl: PendingStartup }), error => contains(error, startupError));
const startup = all.at(-1), startupOwner = getPendingSceneResourceOwners().find(owner => owner.resource === startup);
assert(startupOwner); assert.equal(startup.closed, 0);
assert.throws(() => startupOwner.release(), error => contains(error, startupError)); assert.equal(startup.closed, 0);
startupReleased = true; startupOwner.release(); assert.equal(startup.closed, 1); assert.equal(startup.postReads, 1);

console.log('Original snapshot worker transport/retirement controls authored; no worker-host qualification.');
