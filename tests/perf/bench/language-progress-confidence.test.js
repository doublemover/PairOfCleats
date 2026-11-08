#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  BENCH_PROGRESS_CONFIDENCE_COMPONENT_WEIGHTS,
  BENCH_PROGRESS_CONFIDENCE_SCHEMA_VERSION,
  BENCH_PROGRESS_CONFIDENCE_THRESHOLDS,
  classifyBenchProgressConfidence,
  computeBenchProgressConfidence,
  formatBenchProgressConfidence,
  qualifyBenchProgressObservation
} from '../../../tools/bench/language/logging.js';

assert.equal(BENCH_PROGRESS_CONFIDENCE_SCHEMA_VERSION, 2, 'expected observed-confidence schema version');
assert.deepEqual(
  BENCH_PROGRESS_CONFIDENCE_THRESHOLDS,
  { high: 0.75, medium: 0.5 },
  'expected stable confidence thresholds'
);
assert.deepEqual(
  BENCH_PROGRESS_CONFIDENCE_COMPONENT_WEIGHTS,
  {
    heartbeatRegularity: 0.35,
    queueAge: 0.25,
    inFlightSpread: 0.2,
    stallEvents: 0.2
  },
  'expected stable confidence component weights'
);

assert.equal(classifyBenchProgressConfidence(Number.NaN), 'unknown', 'non-numeric confidence should be unknown');
assert.equal(classifyBenchProgressConfidence(null), 'unknown', 'null confidence should be unknown');
assert.equal(classifyBenchProgressConfidence(1), 'high', '1.0 confidence should be high');
assert.equal(classifyBenchProgressConfidence(0.75), 'high', 'high threshold should be inclusive');
assert.equal(classifyBenchProgressConfidence(0.74), 'medium', 'score below high threshold should be medium');
assert.equal(classifyBenchProgressConfidence(0.5), 'medium', 'medium threshold should be inclusive');
assert.equal(classifyBenchProgressConfidence(0.49), 'low', 'score below medium threshold should be low');

assert.equal(formatBenchProgressConfidence(undefined), 'unknown', 'undefined confidence should be unknown');
assert.equal(formatBenchProgressConfidence(null), 'unknown', 'null confidence should be unknown');
assert.equal(formatBenchProgressConfidence(0.9), 'high 90.0%', 'high confidence should include formatted percentage');
assert.equal(formatBenchProgressConfidence(0.6), 'medium 60.0%', 'medium confidence should include formatted percentage');
assert.equal(formatBenchProgressConfidence(0.2), 'low 20.0%', 'low confidence should include formatted percentage');
assert.equal(formatBenchProgressConfidence(1.2), 'high 100.0%', 'formatted confidence should clamp above 100%');
assert.equal(formatBenchProgressConfidence(-1), 'low 0.0%', 'formatted confidence should clamp below 0%');

const high = computeBenchProgressConfidence({
  heartbeatRegularityScore: 0.9,
  queueAgeScore: 0.8,
  inFlightSpreadScore: 0.7,
  stallEventsScore: 1,
  heartbeatSamples: 24,
  queueSamples: 24,
  inFlightSamples: 24,
  stallSamples: 24
});
assert.equal(high.schemaVersion, BENCH_PROGRESS_CONFIDENCE_SCHEMA_VERSION, 'expected confidence schema on computed payload');
assert.equal(high.bucket, 'high', 'expected weighted high score classification');
assert.equal(high.text, 'high 85.5%', 'expected deterministic formatted weighted confidence');
assert.equal(high.samples.heartbeat, 24, 'expected heartbeat sample count');
assert.equal(high.samples.queueAge, 24, 'expected queue sample count');
assert.equal(high.samples.inFlight, 24, 'expected in-flight sample count');
assert.equal(high.samples.stallEvents, 24, 'expected stall sample count');

const low = computeBenchProgressConfidence({
  heartbeatRegularityScore: 0.2,
  queueAgeScore: 0.2,
  inFlightSpreadScore: 0.2,
  stallEventsScore: 0.2,
  heartbeatSamples: 12,
  queueSamples: 12,
  inFlightSamples: 12,
  stallSamples: 12
});
assert.equal(low.bucket, 'low', 'expected low weighted score classification');
assert.equal(low.text, 'low 20.0%', 'expected deterministic low weighted confidence text');

const partial = computeBenchProgressConfidence({
  heartbeatRegularityScore: 0.4,
  queueAgeScore: null,
  inFlightSpreadScore: null,
  stallEventsScore: 0.2,
  heartbeatSamples: 8,
  queueSamples: 0,
  inFlightSamples: 0,
  stallSamples: 8
});
assert.equal(partial.bucket, 'low', 'expected partial confidence to weight available components only');
assert.equal(partial.text, 'low 32.7%', 'expected normalized score when only subset of components are present');
assert.equal(partial.components.queueAge.score, null, 'expected missing component score to remain null');
assert.equal(partial.components.inFlightSpread.score, null, 'expected missing component score to remain null');

const empty = computeBenchProgressConfidence({});
assert.equal(empty.score, null, 'expected empty confidence payload to report null score');
assert.equal(empty.bucket, 'unknown', 'expected empty confidence payload to classify as unknown');
assert.equal(empty.text, 'unknown', 'expected empty confidence payload to format as unknown');

for (const value of [false, true, '0.8', '', null, undefined, NaN, Infinity]) {
  assert.equal(classifyBenchProgressConfidence(value), 'unknown');
  assert.equal(formatBenchProgressConfidence(value), 'unknown');
}
const noEvidence = computeBenchProgressConfidence({ stallEventsScore: 1, stallSamples: 0 });
assert.equal(noEvidence.score, null, 'a no-stall default without an interval is not evidence');
assert.equal(noEvidence.components.stallEvents.eligible, false);
assert.equal(computeBenchProgressConfidence({ queueAgeScore: 1, queueSamples: 1 }).score, null);
assert.equal(computeBenchProgressConfidence({ inFlightSpreadScore: 1, inFlightSamples: 1 }).score, null);
assert.equal(computeBenchProgressConfidence({ queueAgeScore: true, queueSamples: 2 }).score, null);
assert.equal(computeBenchProgressConfidence({ queueAgeScore: 1, queueSamples: '2' }).score, null);
const evidence = { firstObservedAtMs: 0, lastObservedAtMs: 500, phase: 'parse', taskId: 'worker', staleAfterMs: 1000 };
const observed = qualifyBenchProgressObservation(high, { ...evidence, nowMs: 1000 });
assert.equal(observed.score, high.score); assert.equal(observed.observation.state, 'observed');
assert.equal(observed.observation.ageMs, 500);
const stale = qualifyBenchProgressObservation(high, { ...evidence, nowMs: 1500 });
assert.equal(stale.score, null); assert.equal(stale.bucket, 'unknown');
assert.equal(stale.sampleScore, high.score); assert.equal(stale.observation.state, 'stale');
assert.equal(stale.observation.ageMs, 1000);
const recovered = qualifyBenchProgressObservation(high, { ...evidence, nowMs: 1601, lastObservedAtMs: 1600 });
assert.equal(recovered.score, high.score); assert.equal(recovered.observation.state, 'observed');
assert.deepEqual(recovered.observation.lastContext, { phase: 'parse', taskId: 'worker' });
assert.equal(qualifyBenchProgressObservation(high, { ...evidence, nowMs: 499 }).score, null, 'clock reversal is unknown');
assert.equal(observed.calibratedProbability, false);

console.log('bench language progress confidence test passed');
