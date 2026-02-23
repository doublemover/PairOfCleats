#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRuntimeTelemetry } from '../../../src/index/build/runtime/queues.js';

const telemetry = createRuntimeTelemetry();

telemetry.setInFlightBytes('cpu', { bytes: 1024.9, count: 3.9 });
telemetry.setInFlightBytes('io', { bytes: -20, count: 'invalid' });
const inFlight = telemetry.readInFlightBytes();

assert.equal(inFlight.total, 1024, 'expected in-flight total bytes to be aggregated');
assert.deepEqual(inFlight.channels.cpu, { bytes: 1024, count: 3 }, 'expected cpu channel coercion');
assert.deepEqual(inFlight.channels.io, { bytes: 0, count: 0 }, 'expected invalid io values to clamp');

telemetry.recordDuration('stage1', 75);
telemetry.recordDuration('stage1', 1300);
telemetry.recordDuration('stage1', -1);

const stage1Histogram = telemetry.readDurationHistograms().stage1;
assert.equal(stage1Histogram.count, 3, 'expected histogram sample count');
assert.equal(stage1Histogram.totalMs, 1375, 'expected histogram duration sum');
assert.equal(stage1Histogram.minMs, 0, 'expected negative durations to clamp to zero');
assert.equal(stage1Histogram.maxMs, 1300, 'expected max duration');
assert.equal(stage1Histogram.counts[0], 1, 'expected <=50ms bucket count');
assert.equal(stage1Histogram.counts[1], 1, 'expected <=100ms bucket count');
assert.equal(stage1Histogram.counts[5], 1, 'expected <=2000ms bucket count');
assert.equal(stage1Histogram.overflow, 0, 'expected no overflow for bounded durations');

telemetry.clearInFlightBytes('io');
telemetry.clearDurationHistogram('stage1');
assert.equal(telemetry.readInFlightBytes().channels.io, undefined, 'expected cleared in-flight channel');
assert.equal(telemetry.readDurationHistograms().stage1, undefined, 'expected cleared histogram');

console.log('runtime telemetry collector test passed');
