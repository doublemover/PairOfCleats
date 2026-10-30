import assert from 'node:assert/strict';
import { createMapBuildTimer } from '../../../src/map/build-map/timing.js';
import { observeMapProcessMemory } from '../../../tools/bench/map/observation.js';
import { resolveRuns } from '../../../tools/bench/map/shared.js';

let samples = 0, clock = 0;
const timer = createMapBuildTimer({ now: () => clock++, memoryUsage: () => {
  samples++; return { heapUsed: samples === 3 ? 99 : samples, rss: samples === 3 ? 199 : samples * 10, external: 0, arrayBuffers: 0 };
} });
assert.equal(await timer.track('assembly', () => 42), 42); timer.complete(); timer.complete();
assert.equal(samples, 3); assert.equal(timer.observedBoundaryMax.heapUsed, 99); assert.equal(timer.observedBoundaryMax.rss, 199);
assert.equal(timer.peak, timer.observedBoundaryMax); assert.equal(timer.memoryObservation.includesFinalModel, true);
assert.equal(timer.memoryObservation.sampleCount, 3); assert.equal(timer.memoryObservation.transientCoverage, 'unobserved');
await assert.rejects(timer.track('late', () => {}), /already complete/u);
const unknown = createMapBuildTimer({ memoryUsage: () => ({}), now: () => 0 }); unknown.complete();
assert.equal(unknown.observedBoundaryMax.rss, null, 'missing samples cannot become a zero-byte peak');

const primary = Object.freeze(new Error('map operation failed')), secondary = Object.freeze(new Error('memory observation failed'));
let calls = 0;
const failed = createMapBuildTimer({ memoryUsage: () => { if (++calls === 2) throw secondary; return { rss: 1 }; }, now: () => 0 });
await assert.rejects(failed.track('failed', () => { throw primary; }), error => {
  const seen = new Set(), found = new Set();
  const visit = value => { if (value === primary || value === secondary) found.add(value);
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value); visit(value.cause); for (const child of value.errors || []) visit(child);
  };
  visit(error); assert.ok(found.has(primary)); assert.ok(found.has(secondary)); return true;
});
// Named projection adapter only: this literal counter proves unit conversion,
// not actual transient allocation. The explicit map-serialization qualification
// owner separately requires a fresh-child touched allocation and native RSS.
const observed = observeMapProcessMemory({ before: { rss: 1000, heapUsed: 100 }, after: { rss: 1000, heapUsed: 100 }, through: 'controlled-transient' },
  { resourceUsage: () => ({ maxRSS: 64 }) });
assert.equal(observed.observedBoundaryMax.rss, 1000); assert.equal(observed.processLifetimeRss.bytes, 64 * 1024);
assert.equal(observed.processLifetimeRss.state, 'observed'); assert.equal(observed.processLifetimeRss.scope, 'fresh-child-process-lifetime');
for (const maxRSS of [0, undefined, NaN, Infinity, 1n, '10']) {
  const missing = observeMapProcessMemory({ before: {}, after: {}, through: 'control' }, { resourceUsage: () => ({ maxRSS }) });
  assert.equal(missing.processLifetimeRss.state, 'unavailable'); assert.equal(missing.processLifetimeRss.bytes, null);
}
const inconsistent = observeMapProcessMemory({ before: { rss: 10000 }, after: { rss: 10000 }, through: 'control' }, { resourceUsage: () => ({ maxRSS: 1 }) });
assert.equal(inconsistent.processLifetimeRss.state, 'inconsistent'); assert.equal(inconsistent.processLifetimeRss.bytes, null);
for (const runs of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => resolveRuns(runs), RangeError);
assert.equal(resolveRuns(2), 2); assert.equal(resolveRuns(undefined, 3), 3);
console.log('Map memory owners include the final model, distinguish transient coverage and retain operation/observation failures.');
