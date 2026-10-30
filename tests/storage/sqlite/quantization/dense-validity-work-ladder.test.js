import assert from 'node:assert/strict';
import { PerformanceObserver } from 'node:perf_hooks';
import { createDenseVectorRowPresence } from '../../../../src/shared/dense-vector-validity.js';

const samples = [];
const gc = [], observer = new PerformanceObserver(list => { for (const event of list.getEntries()) gc.push({ startTime: event.startTime,
  duration: event.duration, kind: event.detail.kind }); });
observer.observe({ entryTypes: ['gc'] });
try {
  for (const count of [10000, 100000, 1000000]) {
    const raw = Buffer.alloc(Math.ceil(count / 8)); let expected = 0;
    for (let id = 0; id < count; id++) if (id % 3 !== 1) { raw[id >> 3] |= 1 << (id & 7); expected++; }
    const encoded = raw.toString('base64'); let reads = 0, decodes = 0;
    const validity = { version: 1, encoding: 'bitset-base64', count, validCount: expected,
      get bits() { reads++; return encoded; }, toJSON() { throw new Error('whole metadata serialization is forbidden'); } };
    const from = Buffer.from, memoryBefore = process.memoryUsage(), cpu = process.cpuUsage(), started = performance.now();
    Buffer.from = function (value, ...args) { if (value === encoded && args[0] === 'base64') decodes++; return from.call(this, value, ...args); };
    try {
      const present = createDenseVectorRowPresence({ count, validity }); let completed = 0;
      for (let pass = 0; pass < 2; pass++) for (let id = 0; id < count; id++) if (present(id)) completed++;
      assert.equal(completed, expected * 2); assert.equal(reads, 1); assert.equal(decodes, 1);
      samples.push({ rows: count, completedPresenceChecks: count * 2, presentChecks: completed,
        envelopeReads: reads, base64Decodes: decodes, decodedBytes: raw.length,
        privateBitmapBytes: raw.length, operationBitmapBytes: raw.length, encodedChars: encoded.length,
        startedAtMs: started, elapsedMs: performance.now() - started, cpu: process.cpuUsage(cpu), memoryBefore, memoryAfter: process.memoryUsage(),
        processLifetimeMaxRssKiB: process.resourceUsage().maxRSS });
    } finally { Buffer.from = from; }
    await new Promise(resolve => setImmediate(resolve));
    const sample = samples.at(-1); sample.gcEvents = gc.filter(event => event.startTime >= sample.startedAtMs
    && event.startTime < sample.startedAtMs + sample.elapsedMs);
  }
} finally { observer.disconnect(); }
assert.deepEqual(samples.map(sample => sample.envelopeReads), [1, 1, 1]);
assert.deepEqual(samples.map(sample => sample.base64Decodes), [1, 1, 1]);
console.log(JSON.stringify({ kind: 'serial-validity-work-ladder', scope: 'preparation and O(1) presence work; native SQLite/vector costs are separately qualified by consumer fixtures',
  memoryScope: 'instant snapshots, observed in-region GC entries and explicitly process-lifetime maximum; no per-case peak claim', samples }));
