#!/usr/bin/env node
import assert from 'node:assert/strict';
import { setImmediate as immediate } from 'node:timers/promises';
import { createWorkerPoolQueue } from '../../../src/index/build/workers/pool/queue.js';
let samples = 0, rssArguments = [];
const queue = createWorkerPoolQueue({ pressureWatermarkSoft: 0.5, pressureWatermarkHard: 0.99,
  readMemoryUsage: () => { samples++; return { heapUsed: 75, heapTotal: 100, rss: 100 }; },
  readOwnedRssBytes: parentRss => { rssArguments.push(parentRss); return parentRss; },
  languageThrottleConfig: { enabled: true, heavyLanguages: ['javascript', 'python'], softMaxPerLanguage: 1, hardMaxPerLanguage: 1 } });
const payload = languageId => ({ languageId, mode: 'code' });
try {
  const js = await queue.acquireLanguageThrottleSlot(payload('javascript'));
  const python = await queue.acquireLanguageThrottleSlot(payload('python'));
  const controller = new AbortController(), granted = [];
  const waiting = Array.from({ length: 24 }, (_, index) => {
    const language = index % 2 ? 'python' : 'javascript';
    return queue.acquireLanguageThrottleSlot(payload(language), { signal: controller.signal })
      .then(slot => { granted.push(slot); return slot; }, error => { assert.equal(error.code, 'ABORT_ERR'); return null; });
  });
  const before = queue.snapshot().languageThrottle;
  queue.releaseLanguageThrottleSlot(js); await immediate();
  assert.equal(granted.length, 1); assert.equal(granted[0].languageId, 'javascript');
  assert.equal(queue.snapshot().languageThrottle.capacityWakeCount - before.capacityWakeCount, 1);
  assert.ok(samples <= 3, 'one observation per decision epoch, not per blocked language');
  assert.ok(queue.snapshot().languageThrottle.refreshTimerCount <= 1);
  assert.ok(rssArguments.every(value => value === 100), 'owned RSS aggregation reuses the parent observation');
  controller.abort(); await Promise.all(waiting);
  queue.releaseLanguageThrottleSlot(python); queue.releaseLanguageThrottleSlot(granted[0]);
  assert.equal(queue.snapshot().languageThrottle.refreshTimerCount, 0);
} finally { queue.close(); }
