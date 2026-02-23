#!/usr/bin/env node
import assert from 'node:assert/strict';
import { formatEtaSeconds } from '../../../src/shared/perf/eta.js';

assert.equal(formatEtaSeconds(null), null, 'expected null for invalid values by default');
assert.equal(formatEtaSeconds(-1), null, 'expected null for negative values');
assert.equal(formatEtaSeconds(0), '0m00s', 'expected zero duration format');
assert.equal(formatEtaSeconds(65), '1m05s', 'expected minute-second format');
assert.equal(formatEtaSeconds(3700), '1h01m', 'expected hour-minute format by default');
assert.equal(
  formatEtaSeconds(3700, { preferHours: false }),
  '61m40s',
  'expected minute-only format when preferHours is disabled'
);
assert.equal(
  formatEtaSeconds(undefined, { fallback: 'n/a' }),
  'n/a',
  'expected fallback text for invalid values when provided'
);

console.log('eta format test passed');
