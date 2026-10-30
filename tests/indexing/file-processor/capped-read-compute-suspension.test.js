import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { setImmediate as tick } from 'node:timers/promises';
import { readTextFileWithStreamingCap } from '../../../src/index/build/file-processor/read.js';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core.js';
import { currentSchedulerTaskLease } from '../../../src/shared/concurrency/scheduler-task-scope.js';

// AUTHORED: real capped-reader wait/decode/close path, delayed inert FS handles.
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1) || 'capped';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const until = async check => { for (let i = 0; i < 100 && !check(); i++) await tick(); assert.ok(check()); };
const originalOpen = fs.open, originalReadFile = fs.readFile;
const readGate = deferred(), closeGate = deferred(), source = Buffer.from('hello');
const failure = new Error('capped read failed');
let reading = false, closing = false, closed = false;
const scheduler = createBuildScheduler({ cpuTokens: 1, maxInFlightBytes: 1000 });
fs.readFile = async target => {
  assert.equal(target, 'owned-capped-fixture'); reading = true;
  assert.equal(currentSchedulerTaskLease().used.cpu, 0);
  await readGate.promise; return Buffer.from(source);
};
fs.open = async target => {
  assert.equal(target, 'owned-capped-fixture');
  return {
    read: async (buffer, offset, length, position) => {
      reading = true; assert.equal(currentSchedulerTaskLease().used.cpu, 0);
      await readGate.promise; if (selected === 'failure') throw failure;
      const bytesRead = Math.max(0, Math.min(length, source.length - position));
      source.copy(buffer, offset, position, position + bytesRead); return { bytesRead };
    },
    close: async () => {
      closing = true; assert.equal(currentSchedulerTaskLease().used.cpu, 0);
      await closeGate.promise; closed = true;
    }
  };
};
const task = scheduler.schedule('file', { cpu: 1, bytes: 200 }, () => readTextFileWithStreamingCap({
  absPath: 'owned-capped-fixture', maxBytes: selected === 'uncapped' ? 0 : selected === 'probe' ? 5 : 3,
  stat: selected === 'probe' ? null : { size: source.length }
}));
const rejection = selected === 'failure' ? assert.rejects(task, error => error === failure) : null;
try {
  await until(() => reading);
  assert.equal(scheduler.stats().tokens.cpu.used, 0);
  assert.equal(scheduler.stats().activity.inFlightBytes, 200);
  await scheduler.schedule('ready', { cpu: 1, bytes: 50 }, () => 'ready while reading');
  readGate.resolve();
  if (selected !== 'uncapped') {
    await until(() => closing);
    assert.equal(scheduler.stats().activity.inFlightBytes, 200, 'close remains actual owned settlement');
    await scheduler.schedule('ready', { cpu: 1, bytes: 50 }, () => 'ready while closing');
    closeGate.resolve();
  }
  if (rejection) await rejection;
  else {
    const result = await task;
    assert.equal(result.text, selected === 'uncapped' || selected === 'probe' ? 'hello' : 'hel');
    assert.equal(result.truncated, selected === 'capped');
    if (selected !== 'uncapped') assert.equal(closed, true);
  }
  assert.equal(scheduler.stats().activity.inFlightBytes, 0);
} finally {
  readGate.resolve(); closeGate.resolve(); await Promise.allSettled([task]);
  fs.open = originalOpen; fs.readFile = originalReadFile;
  await scheduler.shutdown({ awaitRunning: true, timeoutMs: 1000 });
}
console.log(`capped reader ${selected} suspends only filesystem waits`);
