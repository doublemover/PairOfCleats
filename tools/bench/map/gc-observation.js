import { PerformanceObserver, performance } from 'node:perf_hooks';
import { getHeapSpaceStatistics } from 'node:v8';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';

/** Event timestamps observe actual GC, including synchronous work. They do not
 * sample or certify a heap peak. No collection is requested by this recorder. */
export const createMapGcObservation = ({ Observer = PerformanceObserver,
  now = () => performance.now(), heapSpaces = getHeapSpaceStatistics,
  flush = () => new Promise(resolve => setImmediate(resolve)), maxEvents = 1024 } = {}) => {
  if (!Number.isSafeInteger(maxEvents) || maxEvents < 1 || maxEvents > 4096) throw new RangeError('Invalid bounded GC observation count.');
  const events = [], boundaries = [], spaces = [];
  let droppedEvents = 0, observer = null, unavailable = null, closed = false;
  const collect = values => {
    for (const entry of values) {
      if (events.length >= maxEvents) { droppedEvents++; continue; }
      events.push({ startTimeMs: entry.startTime, durationMs: entry.duration,
        kind: entry.detail?.kind ?? null, flags: entry.detail?.flags ?? null });
    }
  };
  try {
    if (!Observer.supportedEntryTypes.includes('gc')) unavailable = 'gc-events-unsupported';
    else { observer = new Observer(list => collect(list.getEntries())); observer.observe({ entryTypes: ['gc'] }); }
  } catch (error) {
    unavailable = error.code || error.message;
    try { observer?.disconnect(); }
    catch (cleanup) { throw addStorageFailureContext(error, {}, cleanup, { secondaryPresent: true }); }
    observer = null;
  }
  const disconnect = () => { if (!closed) { closed = true; observer?.disconnect(); } };
  return Object.freeze({
    mark(name) {
      const atMs = now(); boundaries.push({ name, atMs });
      spaces.push({ name, atMs, spaces: heapSpaces().map(row => ({ name: row.space_name,
        sizeBytes: row.space_size, usedBytes: row.space_used_size, physicalBytes: row.physical_space_size })) });
      return atMs;
    },
    async complete(phases) {
      await flush(); if (observer) collect(observer.takeRecords()); disconnect();
      return { schemaVersion: 1, state: unavailable ? 'unavailable' : droppedEvents ? 'incomplete' : 'observed',
        method: 'node-perf-hooks-gc-events', limitation: 'GC occurrence/duration;not-heap-peak-or-phase-RSS',
        reason: unavailable, droppedEvents, boundaries, heapSpaces: spaces,
        phases: Object.fromEntries(Object.entries(phases).map(([name, [start, end]]) => {
          const selected = events.filter(row => row.startTimeMs >= start && row.startTimeMs + row.durationMs <= end);
          return [name, { startMs: start, endMs: end, count: unavailable || droppedEvents ? null : selected.length,
            durationMs: unavailable || droppedEvents ? null : selected.reduce((sum, row) => sum + row.durationMs, 0) }];
        })), events };
    },
    disconnect
  });
};
