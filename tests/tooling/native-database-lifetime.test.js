import assert from 'node:assert/strict';
import { runNativeDatabaseCommand, getPendingNativeDatabaseOwners } from '../../tools/shared/native-database-lifetime.js';

// Actual canonical command owner with inert handles; authored, not executed.
const command = { commandIdentity: 'sqlite.compact' };
const failureOf = work => work.then(() => assert.fail('expected exact native lifetime failure'), error => ({ error }));
const contains = (root, expected) => {
  const pending = [root], seen = new Set();
  while (pending.length) {
    const error = pending.pop();
    if (error === expected) return true;
    if (!error || typeof error !== 'object' || seen.has(error)) continue;
    seen.add(error); pending.push(error.cause, ...(Array.isArray(error.errors) ? error.errors : []));
  }
  return false;
};

for (const value of [undefined, null, false, 0, '']) {
  let closes = 0, owned;
  const handle = { close() { assert.equal(this, handle); closes++; } };
  const failure = await failureOf(runNativeDatabaseCommand(command, async resources => {
    owned = resources;
    resources.own(handle);
    return resources.use(handle, async () => { throw value; });
  }));
  assert.equal(failure.error, value, 'settled falsey operation failures remain exact rejections');
  assert.equal(closes, 1);
  assert.equal(owned.isClosed(handle), true);
  let factoryRan = false, workRan = false;
  assert.throws(() => owned.open(() => { factoryRan = true; return {}; }), /no longer admits/);
  await assert.rejects(owned.use(handle, async () => { workRan = true; }), /no longer admits/);
  assert.equal(factoryRan, false); assert.equal(workRan, false);
}

let closeReads = 0, closes = 0, replace = false;
const originalHandle = { get close() {
  closeReads++;
  if (replace) return () => assert.fail('cannot replace original native close');
  return function () { assert.equal(this, originalHandle); closes++; };
} };
assert.equal(await runNativeDatabaseCommand(command, async resources => {
  resources.own(originalHandle); replace = true; return 0;
}), 0);
assert.equal(closeReads, 1); assert.equal(closes, 1);

let allowClose, announceClose, gatedCloses = 0, returned = false;
const closing = new Promise(resolve => { announceClose = resolve; });
const gate = new Promise(resolve => { allowClose = resolve; });
const gatedHandle = { async close() { gatedCloses++; announceClose(); await gate; } };
const running = runNativeDatabaseCommand(command, async resources => {
  resources.own(gatedHandle);
  const first = resources.close(gatedHandle), second = resources.close(gatedHandle);
  assert.equal(first, second, 'concurrent resource closure joins the original native flight');
  return 'accepted';
}).then(result => { returned = true; return result; });
try {
  await closing;
  assert.equal(returned, false, 'command completion waits for accepted actual close');
  allowClose();
  assert.equal(await running, 'accepted');
  assert.equal(gatedCloses, 1);
} finally { allowClose(); await running; }

let finishWork, enterWork, workCloses = 0, useReturned = false;
const working = new Promise(resolve => { enterWork = resolve; });
const workGate = new Promise(resolve => { finishWork = resolve; });
const accepted = runNativeDatabaseCommand(command, resources => {
  const handle = resources.own({ close() { workCloses++; } });
  void resources.use(handle, async () => { enterWork(); await workGate; return 'accepted native use'; });
  return 'outer callback returned';
}).then(value => { useReturned = true; return value; });
try {
  await working;
  assert.equal(workCloses, 0, 'outer return cannot close a handle before accepted work completes');
  assert.equal(useReturned, false);
  finishWork();
  assert.equal(await accepted, 'outer callback returned');
  assert.equal(workCloses, 1);
} finally { finishWork(); await accepted; }

let outstandingCloses = 0;
const outstanding = Object.freeze(new Error('accepted unawaited operation failed'));
const outstandingFailure = (await failureOf(runNativeDatabaseCommand(command, resources => {
  const handle = resources.own({ close() { outstandingCloses++; } });
  void resources.use(handle, async () => { throw outstanding; });
}))).error;
assert.equal(outstandingFailure, outstanding, 'accepted-work rejection cannot become a successful command');
assert.equal(outstandingCloses, 1);

const primary = Object.freeze(Object.assign(new Error('frozen original database operation'), { code: 'EIO' }));
const cleanup = Object.freeze(new Error('frozen original native close failure'));
let failedCloses = 0, failedResources;
const failedHandle = { close() { failedCloses++; throw cleanup; } };
const failed = (await failureOf(runNativeDatabaseCommand(command, async resources => {
  failedResources = resources; resources.own(failedHandle);
  return resources.use(failedHandle, async () => { throw primary; });
}))).error;
assert.equal(contains(failed, primary), true); assert.equal(contains(failed, cleanup), true);
assert.equal(failed.code, 'EIO'); assert.equal(primary.nativeCleanupError, undefined);
assert.equal(failed.cacheOwnershipReleased(), false);
assert.equal(failed.retryable, false);
assert.equal(getPendingNativeDatabaseOwners().includes(failed.nativeDatabaseLifetime), true);
assert.equal(failed.nativeDatabaseLifetime.handles, 1);
await assert.rejects(failedResources.close(failedHandle), error => error === cleanup);
assert.equal(failedCloses, 1, 'registered finalization cannot retry an already rejected original close');

for (const value of [undefined, null, false, 0, '']) {
  let attempts = 0;
  const failure = (await failureOf(runNativeDatabaseCommand(command, async resources => {
    resources.own({ close() { attempts++; throw value; } });
  }))).error;
  assert.equal(failure.cause, value);
  assert.equal(Object.hasOwn(failure, 'nativeCleanupError'), true);
  assert.equal(failure.nativeCleanupError, value);
  assert.equal(failure.cacheOwnershipReleased(), false);
  assert.equal(attempts, 1);
}

for (const marker of [true, false, undefined]) {
  let confirmed = false;
  const native = Object.freeze(Object.assign(new Error('independent original database work'), {
    ...(marker === undefined ? {} : { cacheOwnershipPending: marker }),
    cacheOwnershipReleased() { assert.equal(this, native); return confirmed; }
  }));
  const failure = (await failureOf(runNativeDatabaseCommand(command, async () => { throw native; }))).error;
  assert.equal(failure.cause, native);
  assert.equal(failure.cacheOwnershipReleased(), false);
  confirmed = true;
  assert.equal(failure.cacheOwnershipReleased(), true, 'only original independent closure can settle its retained observation');
  assert.equal(getPendingNativeDatabaseOwners().includes(failure.nativeDatabaseLifetime), false);
}

let failedClose = 0, independentClose = 0, independentResources;
const independent = { close() { independentClose++; } };
const combined = (await failureOf(runNativeDatabaseCommand(command, async resources => {
  independentResources = resources;
  resources.own(independent);
  resources.own({ close() { failedClose++; throw cleanup; } });
}))).error;
assert.equal(failedClose, 1); assert.equal(independentClose, 1, 'one rejected close cannot skip independent handles');
assert.equal(independentResources.isClosed(independent), true);
assert.equal(combined.cacheOwnershipReleased(), false);
const unconfirmed = (await failureOf(runNativeDatabaseCommand(command, async resources => {
  resources.own({ close: () => false });
}))).error;
assert.match(unconfirmed.message, /explicitly unconfirmed/);
assert.equal(unconfirmed.cacheOwnershipReleased(), false);
console.log('Native command original closure/failure controls authored; execution deferred.');
