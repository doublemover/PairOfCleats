#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createWorkerPoolQueue } from '../../../src/index/build/workers/pool/queue.js';

const queue = createWorkerPoolQueue({
  pressureWatermarkSoft: 0.01,
  pressureWatermarkHard: 0.02,
  maxGlobalRssBytes: 1,
  languageThrottleConfig: {
    enabled: true,
    heavyLanguages: new Set(['typescript']),
    softMaxPerLanguage: 1,
    hardMaxPerLanguage: 1,
    blockHeavyOnHardPressure: false
  }
});

const payload = {
  languageId: 'TypeScript',
  mode: 'code',
  file: 'throttle.ts',
  text: 'const x = 1;',
  size: 14
};

const firstSlot = await queue.acquireLanguageThrottleSlot(payload);
assert.equal(firstSlot?.languageId, 'typescript', 'expected normalized language id for first slot');

let secondResolved = false;
const secondAcquire = queue.acquireLanguageThrottleSlot(payload).then((slot) => {
  secondResolved = true;
  return slot;
});

await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(secondResolved, false, 'expected second slot to block while first is active');

queue.releaseLanguageThrottleSlot(firstSlot);

const secondSlot = await Promise.race([
  secondAcquire,
  new Promise((_, reject) => setTimeout(() => reject(new Error('second slot acquisition timed out')), 500))
]);

assert.equal(secondSlot?.languageId, 'typescript', 'expected second slot to acquire after release');
queue.releaseLanguageThrottleSlot(secondSlot);

const snapshot = queue.snapshot();
assert.ok(snapshot.languageThrottle.waitCount >= 1, 'expected recorded throttle waits');
assert.equal(
  snapshot.languageThrottle.activeByLanguage.typescript,
  undefined,
  'expected no active slots after releases'
);

console.log('worker pool queue throttle wakeup test passed');
