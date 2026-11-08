import assert from 'node:assert/strict';
import { createMapGcObservation } from '../../../tools/bench/map/gc-observation.js';
let listener, time = 0, disconnected = 0;
class NamedGcEventAdapter {
  static supportedEntryTypes = ['gc'];
  constructor(callback) { listener = callback; }
  observe(options) { assert.deepEqual(options, { entryTypes: ['gc'] }); }
  takeRecords() { return []; }
  disconnect() { disconnected++; }
}
const options = { Observer: NamedGcEventAdapter, now: () => time,
  heapSpaces: () => [{ space_name: 'named-young-space', space_size: 8192, space_used_size: 4096, physical_space_size: 8192 }],
  flush: async () => {} };
const recorder = createMapGcObservation(options);
recorder.mark('before'); time = 30; recorder.mark('after');
listener({ getEntries: () => [{ startTime: 2, duration: 3, detail: { kind: 1, flags: 0 } },
  { startTime: 11, duration: 2, detail: { kind: 2, flags: 0 } }, { startTime: 9, duration: 2, detail: { kind: 3 } }] });
const observed = await recorder.complete({ warmup: [0, 10], measured: [10, 20] });
assert.equal(observed.state, 'observed'); assert.equal(observed.events.length, 3);
assert.equal(observed.phases.warmup.count, 1); assert.equal(observed.phases.warmup.durationMs, 3);
assert.equal(observed.phases.measured.count, 1); assert.equal(observed.phases.measured.durationMs, 2);
assert.equal(observed.heapSpaces[0].spaces[0].usedBytes, 4096);
assert.equal(observed.limitation, 'GC occurrence/duration;not-heap-peak-or-phase-RSS');
recorder.disconnect(); assert.equal(disconnected, 1);
class UnavailableGcAdapter { static supportedEntryTypes = []; }
const unavailable = await createMapGcObservation({ ...options, Observer: UnavailableGcAdapter }).complete({ measured: [0, 1] });
assert.equal(unavailable.state, 'unavailable'); assert.equal(unavailable.phases.measured.count, null);
const capped = createMapGcObservation({ ...options, maxEvents: 1 });
listener({ getEntries: () => [{ startTime: 1, duration: 1 }, { startTime: 3, duration: 1 }] });
const incomplete = await capped.complete({ measured: [0, 5] });
assert.equal(incomplete.state, 'incomplete'); assert.equal(incomplete.droppedEvents, 1);
assert.equal(incomplete.phases.measured.count, null, 'capped event streams cannot certify a measured zero/count');
console.log('GC observation uses actual event intervals with independent controls for boundaries, missing support and bounded loss.');
