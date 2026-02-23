#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import {
  createStage1PostingsQueueTelemetry,
  STAGE1_POSTINGS_QUEUE_TELEMETRY_CHANNEL
} from '../../../src/index/build/indexer/steps/process-files/postings-telemetry.js';

ensureTestingEnv(process.env);

const calls = [];
const runtime = {
  telemetry: {
    setInFlightBytes(channel, payload) {
      calls.push({ type: 'set', channel, payload });
    },
    clearInFlightBytes(channel) {
      calls.push({ type: 'clear', channel });
    }
  }
};

const telemetry = createStage1PostingsQueueTelemetry({ runtime });
assert.equal(
  telemetry.channel,
  STAGE1_POSTINGS_QUEUE_TELEMETRY_CHANNEL,
  'expected helper to use stable telemetry channel name'
);

telemetry.emitSnapshot({ pendingCount: 2, pendingBytes: 1024 });
assert.deepEqual(
  calls.shift(),
  {
    type: 'set',
    channel: STAGE1_POSTINGS_QUEUE_TELEMETRY_CHANNEL,
    payload: {
      count: 2,
      bytes: 1024
    }
  },
  'expected queue snapshot to publish pending count/bytes'
);

telemetry.emitSnapshot({ pendingCount: Number.NaN, pendingBytes: null });
assert.deepEqual(
  calls.shift(),
  {
    type: 'set',
    channel: STAGE1_POSTINGS_QUEUE_TELEMETRY_CHANNEL,
    payload: {
      count: 0,
      bytes: 0
    }
  },
  'expected invalid queue metrics to clamp to zero'
);

telemetry.syncQueueState(true);
assert.deepEqual(
  calls.shift(),
  {
    type: 'set',
    channel: STAGE1_POSTINGS_QUEUE_TELEMETRY_CHANNEL,
    payload: {
      count: 0,
      bytes: 0
    }
  },
  'expected enabling queue telemetry to seed a zero snapshot'
);

telemetry.syncQueueState(false);
assert.deepEqual(
  calls.shift(),
  {
    type: 'clear',
    channel: STAGE1_POSTINGS_QUEUE_TELEMETRY_CHANNEL
  },
  'expected disabling queue telemetry to clear in-flight metrics'
);

telemetry.clear();
assert.deepEqual(
  calls.shift(),
  {
    type: 'clear',
    channel: STAGE1_POSTINGS_QUEUE_TELEMETRY_CHANNEL
  },
  'expected helper clear() to clear queue telemetry channel'
);

const noTelemetry = createStage1PostingsQueueTelemetry({ runtime: {} });
noTelemetry.emitSnapshot({ pendingCount: 1, pendingBytes: 2 });
noTelemetry.syncQueueState(true);
noTelemetry.syncQueueState(false);
noTelemetry.clear();

console.log('process-files postings telemetry helper test passed');
