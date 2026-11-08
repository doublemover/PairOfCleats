import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { readTextFileWithStreamingCap } from '../../../src/index/build/file-processor/read.js';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
const shutdown = selected?.startsWith('shutdown-open');
const successfulRead = selected === 'close-false' || selected === 'close-throw';
assert.ok(shutdown || successfulRead || ['frozen', 'null', 'undefined', 'false'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir('capped-read-failure-ownership');
const file = path.join(dir, 'source.txt');
await fs.writeFile(file, 'original source bytes');
const open = fs.open;
const opening = Promise.withResolvers(), opened = Promise.withResolvers();
const closeGate = Promise.withResolvers();
const scheduler = createBuildScheduler({ cpuTokens: 1, maxInFlightBytes: 1000 });
const primary = selected === 'null' ? null : selected === 'undefined' ? undefined
  : selected === 'false' ? false : Object.freeze(new Error('original read failure'));
const cleanupFailure = Object.freeze(new Error('original close failure'));
let descriptor, nativeClose, closeCalls = 0, readCalls = 0, actualClosed = false, publicSettled = false;
const contains = (error, expected, seen = new Set()) => {
  if (Object.is(error, expected)) return true;
  if (!error || typeof error !== 'object' || seen.has(error)) return false;
  seen.add(error);
  return Object.hasOwn(error, 'cause') && contains(error.cause, expected, seen)
    || Array.isArray(error.errors) && error.errors.some(value => contains(value, expected, seen));
};
const until = async predicate => {
  const deadline = Date.now() + 1500;
  while (!predicate() && Date.now() < deadline) await delay(1);
  assert.ok(predicate(), 'bounded owner transition');
};
fs.open = async (target, ...args) => {
  assert.equal(target, file);
  descriptor = await open(target, ...args);
  nativeClose = descriptor.close.bind(descriptor);
  const read = descriptor.read.bind(descriptor);
  descriptor.read = async (...input) => {
    readCalls++;
    if (!successfulRead) throw primary;
    const result = await read(...input);
    assert.equal(result.bytesRead, 3);
    assert.equal(input[0].toString('utf8', 0, 3), 'ori');
    return result;
  };
  descriptor.close = async () => {
    closeCalls++;
    if (shutdown) await closeGate.promise;
    if (selected === 'close-false' && closeCalls === 1) return false;
    if ((selected === 'shutdown-open-close-failure' || !shutdown) && closeCalls === 1) throw cleanupFailure;
    await nativeClose(); actualClosed = true;
  };
  opened.resolve();
  if (shutdown) await opening.promise;
  return descriptor;
};
let work, outcome, failure;
try {
  work = scheduler.schedule('file', { cpu: 1, bytes: 200 }, () =>
    readTextFileWithStreamingCap({ absPath: file, maxBytes: 3, stat: { size: 21 } }));
  outcome = work.then(() => { publicSettled = true; assert.fail('failure cannot become a successful read'); }, error => {
    publicSettled = true; failure = error;
  });
  await opened.promise;
  if (shutdown) {
    await scheduler.shutdown();
    opening.resolve();
    await until(() => closeCalls > 0);
    assert.equal(publicSettled, false, 'descriptor close precedes public task retirement');
    assert.equal(scheduler.stats().activity.inFlightBytes, 200);
    assert.equal(readCalls, 0, 'failed CPU reacquisition cannot execute the reader');
    closeGate.resolve();
  }
  await outcome;
  if (shutdown) {
    assert.match(String(failure?.message), /reacquisition/i);
    assert.equal(readCalls, 0);
  } else {
    if (!successfulRead) assert.ok(contains(failure, primary), 'retain the exact original failure, including falsey values');
    if (selected !== 'close-false') assert.ok(contains(failure, cleanupFailure), 'retain independent cleanup evidence');
    assert.equal(readCalls, 1);
  }
  if (selected === 'shutdown-open-close-failure' || !shutdown) {
    if (selected === 'close-false') assert.match(String(failure.message), /close did not confirm/i);
    else assert.ok(contains(failure, cleanupFailure));
    assert.equal(actualClosed, false);
    assert.equal(scheduler.stats().activity.inFlightBytes, 200, 'failed original close keeps its reservation');
    assert.throws(() => observeStorageResource(failure).requireSettled());
    const session = getContainedFileSession(failure);
    assert.ok(session, 'exact original descriptor supplies close-only recovery');
    await session.releaseAfterClose();
  }
  await until(() => scheduler.stats().activity.inFlightBytes === 0);
  assert.equal(scheduler.stats().tokens.cpu.used, 0);
  assert.equal(actualClosed, true);
  assert.equal(closeCalls, selected === 'shutdown-open' ? 1 : 2);
  await assert.rejects(descriptor.stat(), { code: 'EBADF' });
  assert.equal(await fs.readFile(file, 'utf8'), 'original source bytes');
} finally {
  opening.resolve(); closeGate.resolve(); fs.open = open;
  await Promise.allSettled([outcome].filter(Boolean));
  if (descriptor && !actualClosed) await nativeClose();
  await scheduler.shutdown({ awaitRunning: true, timeoutMs: 1500 });
  await fs.rm(dir, { recursive: true, force: true });
}
console.log(`capped reader ${selected} preserves original failure and descriptor lifetime`);
