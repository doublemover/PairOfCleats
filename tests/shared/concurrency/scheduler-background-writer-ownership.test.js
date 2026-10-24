import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setImmediate as tick } from 'node:timers/promises';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core.js';
import { currentSchedulerTaskLease, withSchedulerCpuSuspended } from '../../../src/shared/concurrency/scheduler-task-scope.js';
import { createQueuedAppendWriter } from '../../../src/shared/io/append-writer.js';
import { atomicWriteJson } from '../../../src/shared/io/atomic-write.js';
import { createPatchQueue } from '../../../src/index/build/build-state/patch-queue.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const root = await makeTempDir('poc-background-writer-owner-'), open = fs.open;
const scheduler = createBuildScheduler({ cpuTokens: 1, ioTokens: 1, maxInFlightBytes: 4096 });
const gate = deferred(), entered = deferred(), applyGate = deferred(), applyEntered = deferred();
let closes = 0, originalHandle = null, writer, queue;
try {
  const file = path.join(root, 'diagnostic.log');
  fs.open = async (name, ...args) => {
    const handle = await open(name, ...args);
    if (name !== file) return handle;
    originalHandle = handle;
    const write = handle.writeFile, close = handle.close;
    handle.writeFile = async function (...values) {
      assert.equal(currentSchedulerTaskLease(), null, 'writer owns its actual I/O independently of the producer');
      entered.resolve(); await gate.promise; return write.apply(this, values);
    };
    handle.close = async function (...values) { closes++; return close.apply(this, values); };
    return handle;
  };
  writer = createQueuedAppendWriter({ filePath: file, syncOnFlush: true });
  assert.equal(await scheduler.schedule('file', { cpu: 1, bytes: 100 }, async () => {
    void writer.enqueue('retained line\n'); await entered.promise; return 'producer finished';
  }), 'producer finished');
  assert.equal(scheduler.stats().tokens.cpu.used, 0);
  assert.equal(closes, 0);
  assert.equal(await scheduler.schedule('next-file', { cpu: 1 }, () => 'admitted'), 'admitted');
  let closed = false; const closing = writer.close().then(() => { closed = true; });
  await tick(); assert.equal(closed, false, 'independent close still fences the exact outstanding write');
  assert.equal(closes, 0); gate.resolve(); await closing;
  assert.equal(closes, 1); originalHandle = null;
  assert.equal(await fs.readFile(file, 'utf8'), 'retained line\n');

  const statePath = path.join(root, 'build_state.json');
  queue = createPatchQueue({ mergeState: (left, right) => ({ ...left, ...right }), recordStateError() {},
    applyStatePatch: async (_key, patch) => {
      assert.equal(currentSchedulerTaskLease(), null);
      applyEntered.resolve(); await withSchedulerCpuSuspended(() => applyGate.promise);
      await atomicWriteJson(statePath, patch); return patch;
    } });
  await scheduler.schedule('metadata-producer', { cpu: 1 }, async () => {
    queue.queueStatePatch(root, { stage: 'owned' }, [], { flushNow: true, waitForFlush: false });
    await applyEntered.promise;
  });
  assert.equal(scheduler.stats().tokens.cpu.used, 0);
  let drained = false; const drain = queue.flushBuildState(root).then(result => { drained = true; return result; });
  await tick(); assert.equal(drained, false, 'file completion cannot acknowledge a pending metadata write');
  applyGate.resolve(); assert.equal((await drain).status, 'flushed');
  assert.equal(JSON.parse(await fs.readFile(statePath, 'utf8')).stage, 'owned');
} finally {
  gate.resolve(); applyGate.resolve(); fs.open = open;
  await queue?.flushBuildState(root).catch(() => {}); await writer?.close().catch(() => {});
  if (originalHandle) await originalHandle.close().catch(() => {});
  await scheduler.shutdown({ awaitRunning: true, timeoutMs: 1000 }); await rmDirRecursive(root);
}
console.log('independently drained diagnostic/state writers retain actual resources without borrowing a retired file task');
