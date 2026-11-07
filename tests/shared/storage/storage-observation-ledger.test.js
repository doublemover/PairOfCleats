import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createStorageObservationLedger } from '../../../src/shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';
import { withStorageDirectory, getStorageDirectorySession } from '../../../src/shared/storage/directory.js';
import { verifyStorageFile } from '../../../src/shared/storage/transfer.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('shared/storage/storage-observation-ledger/')[1];
assert.ok(['original-callbacks', 'getter-failures', 'duplicates-cycles', 'bounds',
  'reentrancy', 'late-context', 'directory-adapter', 'transfer-adapter'].includes(mode));
const rejected = async operation => {
  let failed = false, failure;
  try { await operation(); } catch (error) { failed = true; failure = error; }
  assert.equal(failed, true); return failure;
};

if (mode === 'original-callbacks') {
  const ledger = createStorageObservationLedger();
  let phase = 0, secondaryReady = false, reads = 0, originalCalls = 0;
  const secondary = Object.freeze(Object.assign(new Error('independent pending inspection'), {
    cacheOwnershipReleased() { assert.equal(this, secondary); return secondaryReady; }
  }));
  const primary = new Error('original native observation');
  Object.defineProperty(primary, 'cacheOwnershipReleased', { configurable: true, get() {
    reads++; assert.equal(this, primary);
    return function () { originalCalls++; assert.equal(this, primary); if (phase === 1) throw secondary; return phase === 2; };
  } });
  assert.equal(ledger.remember(primary), primary);
  assert.equal(ledger.isSettled(), false);
  phase = 1; assert.equal(ledger.isSettled(), false);
  Object.defineProperty(primary, 'cacheOwnershipReleased', { value: () => true });
  phase = 2; assert.equal(ledger.isSettled(), false, 'late independent inspection cannot disappear when the first owner settles');
  const calls = originalCalls, snapshot = ledger.snapshot();
  assert.equal(reads, 1); assert.equal(snapshot.observerCount, 2);
  assert.deepEqual(snapshot.inspectionErrors, [secondary]); assert.equal(originalCalls, calls, 'diagnostics do not probe settlement');
  assert.throws(() => snapshot.inspectionErrors.push(primary), TypeError);
  let pending;
  try { ledger.requireSettled(); } catch (error) { pending = error; }
  assert.equal(pending.code, 'ERR_STORAGE_RESOURCE_OBSERVATION_PENDING');
  secondaryReady = true; assert.equal(ledger.isSettled(), true); assert.equal(pending.cacheOwnershipReleased(), true);
} else if (mode === 'getter-failures') {
  for (const value of [undefined, null, false, 0, '', Object.freeze(new Error('frozen getter failure'))]) {
    const ledger = createStorageObservationLedger(), symbol = Symbol('retained field');
    const primary = Object.freeze(Object.defineProperties(new Error('original'), {
      [symbol]: { value: value }, privateField: { value: 'kept', enumerable: false },
      cacheOwnershipReleased: { get() { throw value; } }
    }));
    ledger.remember(primary);
    assert.equal(ledger.isSettled(), false, 'an unreadable original callback cannot become settled');
    assert.ok(ledger.snapshot().inspectionErrors.some(error => Object.is(error, value) || Object.is(error.cause, value)));
    assert.equal(primary[symbol], value); assert.equal(primary.privateField, 'kept');
    assert.equal(Object.getOwnPropertyDescriptor(primary, 'privateField').enumerable, false);
  }
} else if (mode === 'duplicates-cycles') {
  const ledger = createStorageObservationLedger(); let ready = false;
  const first = Object.assign(new Error('same diagnostic'), { cacheOwnershipReleased() { if (!ready) throw second; return true; } });
  const second = Object.assign(new Error('same diagnostic'), { cacheOwnershipReleased() { if (!ready) throw first; return true; } });
  for (let index = 0; index < 1000; index++) ledger.remember(first);
  assert.equal(ledger.snapshot().observerCount, 1);
  assert.equal(ledger.isSettled(), false); assert.equal(ledger.snapshot().observerCount, 2);
  ready = true; assert.equal(ledger.isSettled(), true); assert.equal(ledger.snapshot().complete, true);
  const own = new WeakSet(), owner = createStorageObservationLedger({ isOwnFailure: error => own.has(error) });
  const aggregate = Object.freeze({ cacheOwnershipReleased: () => owner.isSettled() }); own.add(aggregate);
  owner.remember(aggregate); assert.equal(owner.isSettled(), true);
  const independent = createStorageObservationLedger(); independent.remember(aggregate);
  owner.remember(Object.freeze({ cacheOwnershipPending: true }));
  assert.equal(owner.isSettled(), false); assert.equal(independent.isSettled(), false, 'one owner exclusion cannot settle another owner');
} else if (mode === 'bounds') {
  const guards = createStorageObservationLedger();
  for (let index = 0; index < 128; index++) guards.remember({ cacheOwnershipReleased: () => true });
  assert.equal(guards.isSettled(), true); assert.equal(guards.snapshot().observerCount, 128);
  guards.remember({ cacheOwnershipReleased: () => true });
  assert.equal(guards.isSettled(), false); assert.equal(guards.snapshot().complete, false);
  const contexts = createStorageObservationLedger();
  for (let index = 0; index < 128; index++) contexts.remember(addStorageFailureContext(new Error('primary'), {}, new Error('secondary')));
  assert.equal(contexts.isSettled(), true); assert.equal(contexts.snapshot().contextCount, 128);
  contexts.remember(addStorageFailureContext(new Error('primary'), {}, new Error('secondary')));
  assert.equal(contexts.isSettled(), false); assert.equal(contexts.snapshot().contextCount, 128);
  const inspections = createStorageObservationLedger();
  for (let index = 0; index < 65; index++) inspections.remember(Object.defineProperty({}, 'cacheOwnershipReleased', {
    get() { throw new Error('distinct inspection ' + index); }
  }));
  assert.equal(inspections.snapshot().inspectionErrors.length, 64); assert.equal(inspections.snapshot().complete, false);
  inspections.remember({ cacheOwnershipReleased: () => true }); assert.equal(inspections.isSettled(), false, 'overflow is sticky');
} else if (mode === 'reentrancy') {
  const ledger = createStorageObservationLedger(); let recurse = true;
  ledger.remember({ cacheOwnershipReleased() { if (recurse) ledger.isSettled(); return true; } });
  assert.equal(ledger.isSettled(), false, 'ignoring a nested false result cannot confirm a reentrant inspection');
  recurse = false; assert.equal(ledger.isSettled(), true);
  const incomplete = createStorageObservationLedger(); incomplete.markIncomplete();
  assert.equal(incomplete.isSettled(), false); incomplete.remember({}); assert.equal(incomplete.isSettled(), false);
} else if (mode === 'late-context') {
  let phase = 0, secondaryReady = false;
  const secondary = Object.freeze(Object.assign(new Error('late composed inspection'), { cacheOwnershipReleased: () => secondaryReady }));
  const primary = Object.assign(new Error('original context'), {
    cacheOwnershipReleased() { if (phase === 1) throw secondary; return phase === 2; }
  });
  const composed = addStorageFailureContext(primary, { contextLabel: 'actual producer' });
  const ledger = createStorageObservationLedger(); ledger.remember(composed);
  assert.equal(ledger.isSettled(), false); phase = 1; assert.equal(ledger.isSettled(), false);
  phase = 2; assert.equal(ledger.isSettled(), false);
  assert.ok(ledger.snapshot().inspectionErrors.includes(secondary));
  secondaryReady = true; assert.equal(ledger.isSettled(), true);
} else {
  const { dir } = await prepareIsolatedTestCacheDir('observation-ledger-' + mode);
  const open = fs.open, opendir = fs.opendir;
  const filename = path.join(dir, 'source.bin'); await fs.writeFile(filename, 'retained source bytes');
  let phase = 0, secondaryReady = false, closes = 0, reads = 0, session, actual;
  const secondary = Object.freeze(Object.assign(new Error('late original inspection'), { cacheOwnershipReleased: () => secondaryReady }));
  const primary = Object.freeze(Object.assign(new Error('original native read failure'), {
    cacheOwnershipReleased() { assert.equal(this, primary); if (phase === 1) throw secondary; return phase === 2; }
  }));
  try {
    if (mode === 'directory-adapter') fs.opendir = async (...args) => {
      actual = await opendir(...args);
      return { read: async () => { reads++; throw primary; }, close: async () => { closes++; await actual.close(); } };
    };
    else fs.open = async (target, ...args) => {
      const handle = await open(target, ...args); if (target !== filename) return handle;
      actual = handle;
      return new Proxy(handle, { get(owner, key) {
        if (key === 'read') return async () => { reads++; throw primary; };
        if (key === 'close') return async () => { closes++; await owner.close(); };
        const value = Reflect.get(owner, key, owner); return typeof value === 'function' ? value.bind(owner) : value;
      } });
    };
    const failure = await rejected(() => mode === 'directory-adapter'
      ? withStorageDirectory(dir, reader => reader.read()) : verifyStorageFile({ root: dir, file: filename }));
    session = mode === 'directory-adapter' ? getStorageDirectorySession(failure) : failure.storageTransferSession;
    assert.equal(closes, 0); assert.equal(reads, 1);
    phase = 1; await rejected(() => session.releaseAfterClose());
    phase = 2; await rejected(() => session.releaseAfterClose());
    assert.equal(closes, 0, 'settling the first original does not authorize close while the second original remains pending');
    assert.equal(failure.cacheOwnershipReleased(), false);
    secondaryReady = true;
    assert.equal((await session.releaseAfterClose()).settled, true);
    assert.equal(closes, 1); assert.equal(reads, 1, 'metadata recovery never replays a failed read');
    assert.equal(failure.cacheOwnershipReleased(), true);
    await session.releaseAfterClose(); assert.equal(closes, 1);
  } finally {
    fs.open = open; fs.opendir = opendir; phase = 2; secondaryReady = true;
    if (session) await session.releaseAfterClose(); else if (actual) await actual.close();
    assert.ok(path.relative(process.cwd(), dir).startsWith(`.tmp${path.sep}`));
    await fs.rm(dir, { recursive: true, force: true });
  }
}
