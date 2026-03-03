#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createBuildScheduler } from '../../../src/shared/concurrency.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

{
  const scheduler = createBuildScheduler({
    cpuTokens: 1,
    ioTokens: 1,
    memoryTokens: 1
  });
  scheduler.registerQueue('drain', { priority: 10 });

  let releaseFirst = null;
  const first = scheduler.schedule('drain', { cpu: 1 }, async () => (
    new Promise((resolve) => {
      releaseFirst = resolve;
    })
  ));
  await sleep(5);
  const second = scheduler.schedule('drain', { cpu: 1 }, async () => 'second');
  const secondOutcome = second.then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error })
  );
  const shutdownPromise = scheduler.shutdown({ awaitRunning: true, timeoutMs: 1000 });
  setTimeout(() => {
    releaseFirst?.('first');
  }, 20);
  await shutdownPromise;

  assert.equal(await first, 'first', 'expected in-flight task to finish during shutdown drain');
  const secondSettled = await secondOutcome;
  assert.equal(secondSettled?.ok, false, 'expected pending queued work to fail on shutdown');
  assert.match(
    String(secondSettled?.error?.message || ''),
    /scheduler shutdown/,
    'expected pending queued work to be rejected on shutdown'
  );
  await assert.rejects(
    () => scheduler.schedule('drain', { cpu: 1 }, async () => null),
    /shut down/,
    'expected new scheduling to be rejected after shutdown'
  );
}

{
  const scheduler = createBuildScheduler({
    cpuTokens: 1,
    ioTokens: 1,
    memoryTokens: 1
  });
  scheduler.registerQueue('timeout', { priority: 10 });

  let release = null;
  const running = scheduler.schedule('timeout', { cpu: 1 }, async () => (
    new Promise((resolve) => {
      release = resolve;
    })
  ));

  const startedAt = Date.now();
  await scheduler.shutdown({ awaitRunning: true, timeoutMs: 25 });
  const elapsedMs = Date.now() - startedAt;
  assert(elapsedMs >= 10 && elapsedMs < 500, 'expected bounded shutdown wait window');

  release?.('ok');
  assert.equal(await running, 'ok', 'expected timed-out shutdown wait to not cancel in-flight work');
}

console.log('scheduler shutdown drain test passed');
