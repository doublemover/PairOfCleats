#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { buildOrderedAppender } from '../../../src/index/build/indexer/steps/process-files/ordered.js';
import { STAGE1_SEQ_STATE } from '../../../src/index/build/indexer/steps/process-files/ordering.js';

applyTestEnv();

const committed = [];
const appender = buildOrderedAppender(
  async (result) => {
    committed.push(result.id);
  },
  {},
  {
    expectedIndices: [0, 1]
  }
);

appender.noteInFlight(0, 100);
appender.noteInFlight(1, 101);
const seq1Done = appender.enqueue(1, { id: 1 }, null);

const resetCount = appender.resetForRetry([0, 1]);
assert.equal(resetCount, 1, 'expected only the non-terminal head seq to reset for retry');

const snapshotAfterReset = appender.snapshot();
assert.equal(snapshotAfterReset.nextIndex, 0, 'expected commit head to remain on reset seq');
assert.equal(snapshotAfterReset.inFlightCount, 0, 'expected non-terminal in-flight state to clear');
assert.equal(snapshotAfterReset.headState, STAGE1_SEQ_STATE.UNSEEN, 'expected head seq to return to unseen');

const seq0Done = appender.enqueue(0, { id: 0 }, null);
await Promise.all([seq0Done, seq1Done]);
await appender.drain();
appender.assertCompletion();

assert.deepEqual(committed, [0, 1], 'expected retried head seq to commit before buffered later seq');

console.log('ordered appender retry reset test passed');
