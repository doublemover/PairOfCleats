#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { resolveAdaptiveBenchTimeoutMs } from '../../../tools/bench/language/timeout.js';

ensureTestingEnv(process.env);

const makeMap = (count) => new Map(
  Array.from({ length: Math.max(0, Number(count) || 0) }, (_, index) => [`k${index}`, index + 1])
);

const lineStats = {
  totals: {
    code: 300_000,
    prose: 8_000,
    'extracted-prose': 310_000,
    records: 0
  },
  linesByFile: {
    code: makeMap(1_200),
    prose: makeMap(20),
    'extracted-prose': makeMap(1_300),
    records: makeMap(0)
  }
};

const noBuild = resolveAdaptiveBenchTimeoutMs({
  baseTimeoutMs: 15 * 60 * 1000,
  lineStats,
  buildIndex: false
});
assert.equal(noBuild, 15 * 60 * 1000, 'expected non-build runs to retain base timeout');

const autoscaled = resolveAdaptiveBenchTimeoutMs({
  baseTimeoutMs: 15 * 60 * 1000,
  lineStats,
  buildIndex: true,
  buildSqlite: true,
  queryCount: 25,
  backendCount: 2,
  queryConcurrency: 4,
  realEmbeddings: true
});
assert.ok(autoscaled > (15 * 60 * 1000), 'expected build runs to autoscale timeout floor upward');
assert.ok(autoscaled >= (45 * 60 * 1000), 'expected large build/query workloads to raise timeout aggressively');

const autoscaledStub = resolveAdaptiveBenchTimeoutMs({
  baseTimeoutMs: 15 * 60 * 1000,
  lineStats,
  buildIndex: true,
  buildSqlite: true,
  queryCount: 25,
  backendCount: 2,
  queryConcurrency: 4,
  realEmbeddings: false
});
assert.ok(
  autoscaled > autoscaledStub,
  'expected real embeddings workloads to budget more timeout than stub embeddings'
);

const capped = resolveAdaptiveBenchTimeoutMs({
  baseTimeoutMs: 10 * 60 * 1000,
  lineStats,
  buildIndex: true,
  buildSqlite: true,
  maxTimeoutMs: 15 * 60 * 1000
});
assert.equal(capped, 15 * 60 * 1000, 'expected timeout autoscale to respect cap');

const disabled = resolveAdaptiveBenchTimeoutMs({
  baseTimeoutMs: 0,
  lineStats,
  buildIndex: true,
  buildSqlite: true
});
assert.equal(disabled, 0, 'expected explicit timeout disable (0) to remain disabled');

const objectLineStats = {
  totals: lineStats.totals,
  linesByFile: {
    code: Object.fromEntries(Array.from({ length: 350 }, (_, i) => [`c${i}`, i + 1])),
    prose: Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`p${i}`, i + 1])),
    'extracted-prose': Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`x${i}`, i + 1])),
    records: {}
  }
};
const objectAutoscaled = resolveAdaptiveBenchTimeoutMs({
  baseTimeoutMs: 15 * 60 * 1000,
  lineStats: objectLineStats,
  buildIndex: true,
  buildSqlite: false,
  realEmbeddings: true
});
assert.ok(
  objectAutoscaled > (15 * 60 * 1000),
  'expected autoscale to count object-shaped linesByFile inputs'
);

console.log('bench-language timeout autoscale test passed');
