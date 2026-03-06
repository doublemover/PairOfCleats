import assert from 'node:assert/strict';
import { destroyPiscinaPool, forceTerminatePiscinaThreads } from '../../../src/shared/piscina-cleanup.js';

const forcedOnlyWorkers = [
  {
    terminateCalls: 0,
    async terminate() {
      this.terminateCalls += 1;
      return 0;
    }
  },
  {
    terminateCalls: 0,
    async terminate() {
      this.terminateCalls += 1;
      return 0;
    }
  }
];

const forcedOnlySummary = await forceTerminatePiscinaThreads(
  { threads: forcedOnlyWorkers },
  { label: 'test-force-only', terminateTimeoutMs: 100 }
);
assert.equal(forcedOnlySummary.attempted, 2, 'expected forced terminate attempts for each worker');
assert.equal(forcedOnlySummary.terminated, 2, 'expected both workers to terminate cleanly');
assert.equal(forcedOnlyWorkers[0].terminateCalls, 1, 'expected first worker terminate call');
assert.equal(forcedOnlyWorkers[1].terminateCalls, 1, 'expected second worker terminate call');

const workers = [
  {
    terminateCalls: 0,
    async terminate() {
      this.terminateCalls += 1;
      return 0;
    }
  },
  {
    terminateCalls: 0,
    async terminate() {
      this.terminateCalls += 1;
      return 0;
    }
  }
];
const neverResolves = new Promise(() => {});
let destroyCalls = 0;
const pool = {
  threads: workers,
  async destroy() {
    destroyCalls += 1;
    return neverResolves;
  }
};

const destroyResult = await destroyPiscinaPool(pool, {
  label: 'test-timeout',
  destroyTimeoutMs: 25,
  terminateTimeoutMs: 100
});

assert.equal(destroyCalls, 1, 'expected one destroy attempt');
assert.equal(destroyResult.skipped, false, 'expected timeout destroy path to run');
assert.equal(destroyResult.timedOut, true, 'expected destroy timeout to trigger hard-stop');
assert.equal(destroyResult.forced, true, 'expected timeout path to force terminate workers');
assert.equal(destroyResult.forcedSummary?.attempted, 2, 'expected forced termination summary to include both workers');
assert.equal(workers[0].terminateCalls, 1, 'expected first pool worker terminate call');
assert.equal(workers[1].terminateCalls, 1, 'expected second pool worker terminate call');

console.log('piscina cleanup timeout test passed');
