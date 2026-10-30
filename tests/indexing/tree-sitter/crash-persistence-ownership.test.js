#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createCrashPersistence, waitForSchedulerCrashPersistence, withSchedulerCrashPersistence } from '../../../src/index/build/tree-sitter-scheduler/runner/crash-persistence.js';
import { createSchedulerCrashTracker } from '../../../src/index/build/tree-sitter-scheduler/runner/crash-tracker.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const contains = (value, expected) => {
  const stack = [value], seen = new Set();
  while (stack.length) {
    const current = stack.pop(); if (current === expected) return true;
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current); stack.push(current.cause, ...(Array.isArray(current.errors) ? current.errors : []));
  }
  return false;
};
let released = false, metadataReads = 0;
const pending = Object.freeze(Object.defineProperties(new Error('original sink failure'), {
  cacheOwnershipPending: { value: true }, cacheOwnershipReleased: { value: () => released },
  code: { get() { metadataReads++; return 'EHELD'; } }
}));
const owner = createCrashPersistence();
let durable = 0, external = 0;
await owner.enqueue(async () => {
  await owner.attempt('local', 'fixture-local', () => { throw pending; });
  await owner.attempt('durable', 'fixture-durable', async () => { durable++; });
  await owner.attempt('external', null, async () => { external++; });
});
assert.equal(durable, 1); assert.equal(external, 1); assert.equal(metadataReads, 0,
  'report classification cannot inspect diagnostics before the original resource settles');
assert.equal(owner.snapshot().pending, true); assert.equal(owner.snapshot().ok, false);
let blocked;
try { await owner.wait(); assert.fail('unsettled evidence must block completion'); }
catch (error) { blocked = error; }
assert.ok(contains(blocked, pending)); assert.equal(blocked.cacheOwnershipReleased(), false);
released = true;
assert.equal(blocked.cacheOwnershipReleased(), true);
assert.equal((await owner.wait()).pending, false); assert.equal(durable, 1); assert.equal(external, 1,
  'settlement does not retry previously failed or completed sinks');

let inspectionReleased = false;
const inspection = Object.freeze(Object.assign(new Error('diagnostic getter failed'), {
  cacheOwnershipPending: true, cacheOwnershipReleased: () => inspectionReleased
}));
const opaque = Object.freeze(Object.defineProperty(new Error('opaque failure'), 'code', { get() { throw inspection; } }));
const diagnosticOwner = createCrashPersistence();
await diagnosticOwner.enqueue(async () => {
  await diagnosticOwner.attempt('local', null, () => { throw opaque; });
  await diagnosticOwner.attempt('durable', null, () => { durable++; });
});
await assert.rejects(diagnosticOwner.wait(), error => contains(error, opaque) && contains(error, inspection)
  && error.cacheOwnershipReleased() === false);
assert.equal(durable, 2, 'throwing metadata must not suppress the independent durable sink');
inspectionReleased = true; assert.equal((await diagnosticOwner.wait()).pending, false);

let releaseWarning, enterWarning;
const warningGate = new Promise(resolve => { releaseWarning = resolve; });
const warningEntered = new Promise(resolve => { enterWarning = resolve; });
const warningOwner = createCrashPersistence({ log: async () => { enterWarning(); await warningGate; } });
const operation = warningOwner.enqueue(async () => {
  await warningOwner.attempt('local', null, () => { throw new Error('settled disk failure'); });
  await warningOwner.attempt('durable', null, () => { durable++; });
  await warningOwner.attempt('external', null, () => { external++; });
});
await warningEntered;
assert.equal(durable, 3); assert.equal(external, 2, 'all original evidence sinks precede the held warning callback');
assert.equal(warningOwner.snapshot().ok, false); assert.ok(warningOwner.snapshot().pendingOperations >= 1);
await warningOwner.enqueue(() => warningOwner.attempt('external', null, () => { external++; }));
assert.equal(external, 3, 'held diagnostics cannot block a later event from reaching its evidence sinks');
let deadline;
try {
  await waitForSchedulerCrashPersistence({ waitForPersistence: warningOwner.wait, isPersistenceSettled: warningOwner.isSettled },
    { mode: 'fixture', timeoutMs: 5 });
  assert.fail('a pending warning must not be reported as completed crash telemetry');
} catch (error) { deadline = error; }
assert.equal(deadline.code, 'BUILD_CLEANUP_TIMEOUT'); assert.equal(deadline.cacheOwnershipReleased(), false);
releaseWarning(); await operation; await warningOwner.wait(); assert.equal(deadline.cacheOwnershipReleased(), true);
const impostor = Object.freeze(Object.assign(new Error('external timeout-shaped failure'), { code: 'BUILD_CLEANUP_TIMEOUT' }));
await assert.rejects(waitForSchedulerCrashPersistence({ waitForPersistence() { throw impostor; },
  isPersistenceSettled() { assert.fail('an external error cannot acquire deadline ownership'); } }), error => error === impostor);

const falsey = createCrashPersistence();
for (const error of [undefined, null, false, 0, '']) await falsey.enqueue(() => falsey.attempt('external', null, () => { throw error; }));
assert.equal((await falsey.wait()).failures.length, 5); assert.equal(falsey.snapshot().pending, false);

// The actual tracker retains original sink ownership while its real atomic
// local/durable publishers finish. No parser, native build or child is involved.
const { dir } = await prepareIsolatedTestCacheDir('crash-persistence-ownership');
const baseDir = path.join(dir, 'local'); await fs.mkdir(baseDir);
let trackerReleased = false;
const trackerFailure = Object.freeze(Object.assign(new Error('external sink still owns resource'), {
  cacheOwnershipPending: true, cacheOwnershipReleased: () => trackerReleased
}));
const tracker = createSchedulerCrashTracker({ runtime: { repoCacheRoot: path.join(dir, 'repo'), buildId: 'owned' },
  outDir: path.join(dir, 'index'), paths: { baseDir }, groupByGrammarKey: new Map(),
  crashLogger: { persistForensicBundle() { throw trackerFailure; } } });
await tracker.recordFailure({ grammarKey: 'fixture', error: Object.assign(new Error('parser failure'), { result: { exitCode: 7 } }) });
await assert.rejects(tracker.waitForPersistence(), error => contains(error, trackerFailure));
for (const file of [tracker.getBundlePath(), tracker.getDurableBundlePath()]) {
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).events.length, 1);
}
assert.equal(tracker.summarize().persistence.pending, true);
trackerReleased = true;
const settled = await tracker.waitForPersistence(); assert.equal(settled.ok, false); assert.equal(settled.pending, false);
assert.equal(tracker.isPersistenceSettled(), true);

let closeoutWaits = 0;
const ordinaryFailure = Object.freeze(new Error('scheduler execution failed after recording evidence'));
const settledTracker = { isPersistenceSettled: tracker.isPersistenceSettled,
  waitForPersistence() { closeoutWaits++; return tracker.waitForPersistence(); } };
await assert.rejects(withSchedulerCrashPersistence(settledTracker, { mode: 'fixture' }, async () => {
  throw ordinaryFailure;
}), error => error === ordinaryFailure);
assert.equal(closeoutWaits, 1, 'exceptional exit still joins the actual tracker once');
assert.equal(await withSchedulerCrashPersistence(settledTracker, { mode: 'fixture' }, async wait => {
  await wait(); await wait(); return 'qualified-lookup';
}), 'qualified-lookup');
assert.equal(closeoutWaits, 2, 'normal admission and finalization share one original wait');
for (const value of [undefined, null, false, 0, '']) {
  let caught = false;
  try { await withSchedulerCrashPersistence(settledTracker, {}, () => { throw value; }); }
  catch (error) { caught = true; assert.equal(error, value); }
  assert.equal(caught, true, 'falsey scheduler failures cannot become success');
}
let dualReleased = false;
const dualFailure = Object.freeze(Object.assign(new Error('separately owned closeout failure'), {
  cacheOwnershipPending: true, cacheOwnershipReleased: () => dualReleased
}));
const dual = createCrashPersistence();
await dual.enqueue(() => dual.attempt('external', null, () => { throw dualFailure; }));
await assert.rejects(withSchedulerCrashPersistence({ waitForPersistence: dual.wait, isPersistenceSettled: dual.isSettled },
  { mode: 'fixture' }, () => { throw ordinaryFailure; }),
error => contains(error, ordinaryFailure) && contains(error, dualFailure) && error.cacheOwnershipReleased() === false);
dualReleased = true; await dual.wait();
console.log('Crash evidence preserves sink/inspection ownership and joins real warning work before deadline-qualified completion.');
