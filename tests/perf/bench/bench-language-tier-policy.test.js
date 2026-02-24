#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  BENCH_TIER_ORDER,
  BENCH_TIER_SIZE_RANGES,
  classifyBenchTierBySize,
  validateBenchTierConfig
} from '../../../tools/bench/language/tier-policy.js';

for (const metricKey of ['loc', 'files']) {
  let previousMax = null;
  for (const tier of BENCH_TIER_ORDER) {
    const range = BENCH_TIER_SIZE_RANGES[tier]?.[metricKey];
    assert.ok(Array.isArray(range) && range.length === 2, `${tier}.${metricKey} range missing`);
    const [min, max] = range;
    assert.ok(Number.isFinite(min), `${tier}.${metricKey} min must be finite`);
    assert.ok(max === Number.POSITIVE_INFINITY || Number.isFinite(max), `${tier}.${metricKey} max invalid`);
    assert.ok(min < max, `${tier}.${metricKey} must be non-empty`);
    if (previousMax != null) {
      assert.equal(min, previousMax, `${metricKey} ranges must be contiguous`);
    }
    previousMax = max;
  }
}

assert.equal(classifyBenchTierBySize({ loc: 0 }), 'small');
assert.equal(classifyBenchTierBySize({ loc: 24_999 }), 'small');
assert.equal(classifyBenchTierBySize({ loc: 25_000 }), 'medium');
assert.equal(classifyBenchTierBySize({ loc: 300_000 }), 'big');
assert.equal(classifyBenchTierBySize({ loc: 3_000_000 }), 'huge');
assert.equal(classifyBenchTierBySize({ files: 0 }), 'small');
assert.equal(classifyBenchTierBySize({ files: 3_500 }), 'big');
assert.equal(classifyBenchTierBySize({ files: 30_000 }), 'huge');

const configPath = path.join(process.cwd(), 'benchmarks', 'repos.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const validation = validateBenchTierConfig(config);
assert.equal(validation.ok, true, `tier config validation failed: ${validation.issues[0]?.message || 'unknown issue'}`);

console.log('bench-language tier policy test passed');

