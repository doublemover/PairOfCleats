#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  BENCH_PROGRESS_CONFIDENCE_SCHEMA_VERSION,
  BENCH_PROGRESS_CONFIDENCE_THRESHOLDS,
  classifyBenchProgressConfidence,
  formatBenchProgressConfidence
} from '../../../tools/bench/language/logging.js';

assert.equal(BENCH_PROGRESS_CONFIDENCE_SCHEMA_VERSION, 1, 'expected confidence schema version');
assert.deepEqual(
  BENCH_PROGRESS_CONFIDENCE_THRESHOLDS,
  { high: 0.75, medium: 0.5 },
  'expected stable confidence thresholds'
);

assert.equal(classifyBenchProgressConfidence(Number.NaN), 'unknown', 'non-numeric confidence should be unknown');
assert.equal(classifyBenchProgressConfidence(1), 'high', '1.0 confidence should be high');
assert.equal(classifyBenchProgressConfidence(0.75), 'high', 'high threshold should be inclusive');
assert.equal(classifyBenchProgressConfidence(0.74), 'medium', 'score below high threshold should be medium');
assert.equal(classifyBenchProgressConfidence(0.5), 'medium', 'medium threshold should be inclusive');
assert.equal(classifyBenchProgressConfidence(0.49), 'low', 'score below medium threshold should be low');

assert.equal(formatBenchProgressConfidence(undefined), 'unknown', 'undefined confidence should be unknown');
assert.equal(formatBenchProgressConfidence(0.9), 'high 90.0%', 'high confidence should include formatted percentage');
assert.equal(formatBenchProgressConfidence(0.6), 'medium 60.0%', 'medium confidence should include formatted percentage');
assert.equal(formatBenchProgressConfidence(0.2), 'low 20.0%', 'low confidence should include formatted percentage');
assert.equal(formatBenchProgressConfidence(1.2), 'high 100.0%', 'formatted confidence should clamp above 100%');
assert.equal(formatBenchProgressConfidence(-1), 'low 0.0%', 'formatted confidence should clamp below 0%');

console.log('bench language progress confidence test passed');
