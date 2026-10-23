import assert from 'node:assert/strict';
import { createCompileController } from '../../../src/map/workspace/reladraw.js';
import { captureSceneResource, preserveSceneCleanupFailures } from '../../../src/map/isometric/client/scene-retirement.js';

const contains = (error, original, visited = new Set()) => {
  if (Object.is(error, original)) return true;
  if (!error || typeof error !== 'object' || visited.has(error)) return false;
  visited.add(error);
  const cause = Object.getOwnPropertyDescriptor(error, 'cause');
  return (cause && contains(cause.value, original, visited))
    || (Object.getOwnPropertyDescriptor(error, 'errors')?.value || []).some(value => contains(value, original, visited));
};
const workers = [];
class Worker {
  constructor() { workers.push(this); this.closes = 0; this.posts = 0; }
  postMessage() { this.posts++; }
  terminate() { this.closes++; if (this.failed) throw this.failed; }
}
// Cancellation settles even if native termination fails, and a retired client
// cannot free a JavaScript slot for another still-running native worker.
const compiler = createCompileController({ WorkerClass: Worker });
const pending = compiler.compile('node a').catch(error => error), worker = workers.at(-1);
const cleanup = Object.freeze(new Error('original termination failure')); worker.failed = cleanup;
const outcome = compiler.cancel(), rejected = await pending;
assert.equal(outcome.retired, true); assert.equal(contains(rejected, cleanup), true);
assert.equal(worker.closes, 1);
worker.terminate = () => { throw new Error('sibling termination method'); };
worker.onmessage({ data: { svg: 'late' } });
await assert.rejects(compiler.compile('node replacement'), /controller retired/);
assert.equal(workers.length, 1); assert.equal(worker.posts, 1);
worker.failed = null;
await compiler.pendingOwners[0].releaseAsync();
assert.equal(worker.closes, 2); assert.equal(compiler.pendingOwners.length, 0);
await assert.rejects(compiler.compile('node after_reconciliation'), /controller retired/);

// Success remains success only after the original close was confirmed. A fresh
// controller supports ordinary cancellation and independent later compilation.
const fresh = createCompileController({ WorkerClass: Worker });
const cancelled = fresh.compile('node old').catch(error => error);
fresh.cancel(); assert.equal((await cancelled).name, 'AbortError');
const accepted = fresh.compile('node current'), current = workers.at(-1);
current.onmessage({ data: { svg: 'accepted' } });
assert.equal((await accepted).svg, 'accepted'); assert.equal(current.closes, 1);
assert.equal(fresh.pendingOwners.length, 0); assert.equal(fresh.retired, false);

// Every original observer is a prerequisite, including an independent cache
// blocker inside a privately composed scene failure and a lookalike owner.
let released = false, diagnosticReleased = false;
const unknown = Object.freeze(Object.defineProperties(new Error('pending original post'), {
  sceneOwnershipReleased: { value: () => released }, cacheOwnershipReleased: { value: () => diagnosticReleased },
  sceneResourceOwner: { value: { release: () => { throw new Error('lookalike must not run'); } } }
}));
let childFailed = true, childCloses = 0;
const childFailure = Object.freeze(new Error('original independent child close'));
const child = captureSceneResource({ dispose() { childCloses++; if (childFailed) throw childFailure; } }, 'original compiler child');
let originalChildFailure;
try { child.retire(); } catch (error) { originalChildFailure = error; }
const mixed = preserveSceneCleanupFailures(originalChildFailure, [unknown], { hasPrimary: true, forceAggregate: true });
class PendingWorker extends Worker { postMessage() { this.posts++; throw mixed; } }
const gated = createCompileController({ WorkerClass: PendingWorker });
const failedPost = await gated.compile('node pending').catch(error => error), gatedWorker = workers.at(-1);
assert.equal(contains(failedPost, unknown), true); assert.equal(gatedWorker.closes, 0);
const originalOwner = gated.pendingOwners[0];
released = true; await assert.rejects(originalOwner.releaseAsync()); assert.equal(gatedWorker.closes, 0);
childFailed = false; child.release(); assert.equal(childCloses, 2);
await assert.rejects(originalOwner.releaseAsync()); assert.equal(gatedWorker.closes, 0);
diagnosticReleased = true; await originalOwner.releaseAsync(); assert.equal(gatedWorker.closes, 1);
await assert.rejects(gated.compile('node forbidden'), /controller retired/);

// A failed terminate's own original work also gates deliberate native retry.
let terminationReleased = false;
const terminationWork = Object.freeze(Object.defineProperty(new Error('native termination work pending'),
  'sceneOwnershipReleased', { value: () => terminationReleased }));
const native = createCompileController({ WorkerClass: Worker });
const nativeResult = native.compile('node native').catch(error => error), nativeWorker = workers.at(-1);
nativeWorker.failed = terminationWork; native.cancel(); await nativeResult;
const nativeOwner = native.pendingOwners[0];
await assert.rejects(nativeOwner.releaseAsync()); assert.equal(nativeWorker.closes, 1);
terminationReleased = true; nativeWorker.failed = null;
await nativeOwner.releaseAsync(); assert.equal(nativeWorker.closes, 2);

// A setter can install a callback then throw a falsey primary. The worker is
// still closed, the original value is retained, and no post is attempted.
class SetterWorker extends Worker { set onmessage(value) { this.callback = value; throw undefined; } }
const setter = createCompileController({ WorkerClass: SetterWorker });
const falsey = await setter.compile('node setter').catch(error => error);
assert.equal(contains(falsey, undefined), true);
assert.equal(workers.at(-1).closes, 1); assert.equal(workers.at(-1).posts, 0);

// Native work cannot close its own worker while the original constructor/post
// stack runs. Cancellation plus a later throw retain both original outcomes.
let reentrant, inConstructor = false, inPost = false;
const postFailure = Object.freeze(new Error('post failed after cancellation'));
class ReentrantWorker extends Worker {
  constructor() { super(); inConstructor = true; reentrant.cancel(); inConstructor = false; }
  terminate() { assert.equal(inConstructor, false); assert.equal(inPost, false); super.terminate(); }
}
reentrant = createCompileController({ WorkerClass: ReentrantWorker });
assert.equal((await reentrant.compile('node constructor').catch(error => error)).name, 'AbortError');
assert.equal(workers.at(-1).closes, 1); assert.equal(workers.at(-1).posts, 0);
// Use a separate non-cancelling constructor to reach the original post stack.
class PostWorker extends Worker {
  postMessage() { inPost = true; try { reentrant.cancel(); throw postFailure; } finally { inPost = false; } }
  terminate() { assert.equal(inPost, false); super.terminate(); }
}
reentrant = createCompileController({ WorkerClass: PostWorker });
const postOutcome = await reentrant.compile('node post').catch(error => error);
assert.equal(contains(postOutcome, postFailure), true); assert.equal(workers.at(-1).closes, 1);
console.log('Original Reladraw worker outcomes and explicit termination ownership controls passed.');
