#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  buildBatchObservabilityHotspotRows,
  compareByOperator
} from '../../src/contracts/validators/usr-matrix/observability-helpers.js';
import {
  normalizeObservedResultMap,
  resolveObservedGatePass,
  resolveObservedRedactionResult
} from '../../src/contracts/validators/usr-matrix/profile-helpers.js';
import {
  normalizeReportScope,
  toFixedDays,
  toIsoDate
} from '../../src/contracts/validators/usr-matrix/report-shaping.js';
import { applyRuntimeOverride } from '../../src/contracts/validators/usr-matrix/runtime-config.js';

const errors = [];
const warnings = [];

const boolOverride = applyRuntimeOverride({
  row: {
    key: 'enableThing',
    valueType: 'boolean',
    strictModeBehavior: 'allow'
  },
  layerLabel: 'env',
  rawValue: 'true',
  strictMode: true,
  errors,
  warnings
});
assert.deepEqual(boolOverride, { ok: true, value: true });

const integerOverride = applyRuntimeOverride({
  row: {
    key: 'maxQueued',
    valueType: 'integer',
    minValue: 1,
    maxValue: 10,
    strictModeBehavior: 'allow'
  },
  layerLabel: 'argv',
  rawValue: '7',
  strictMode: true,
  errors,
  warnings
});
assert.deepEqual(integerOverride, { ok: true, value: 7 });

const invalidOverride = applyRuntimeOverride({
  row: {
    key: 'mode',
    valueType: 'enum',
    allowedValues: ['safe', 'fast'],
    strictModeBehavior: 'allow'
  },
  layerLabel: 'argv',
  rawValue: 'broken',
  strictMode: false,
  errors,
  warnings
});
assert.equal(invalidOverride.ok, false);
assert.equal(warnings.length >= 1, true, 'expected invalid override warning');

assert.equal(compareByOperator({ left: 5, operator: '>=', right: 4 }), true);
assert.equal(compareByOperator({ left: 5, operator: '<', right: 4 }), false);

const hotspotRows = buildBatchObservabilityHotspotRows([
  { laneId: 'b', scopeId: 'scope-b', profileScope: 'batch' },
  { laneId: 'a', scopeId: 'scope-a', profileScope: 'batch' },
  { laneId: 'c', scopeId: 'scope-c', profileScope: 'batch' }
], new Map([
  ['a', { durationMs: 100, peakMemoryMb: 20, parserTimePerSegmentMs: 4 }],
  ['b', { durationMs: 300, peakMemoryMb: 10, parserTimePerSegmentMs: 6 }],
  ['c', { durationMs: 200, peakMemoryMb: 30, parserTimePerSegmentMs: 5 }]
]));

assert.deepEqual(hotspotRows.map((row) => row.laneId), ['a', 'b', 'c'], 'expected deterministic lane sort');
assert.equal(hotspotRows.find((row) => row.laneId === 'b')?.durationRank, 1);
assert.equal(hotspotRows.find((row) => row.laneId === 'c')?.memoryRank, 1);
assert.equal(hotspotRows.find((row) => row.laneId === 'b')?.isParserTimeHotspot, true);

const observedById = normalizeObservedResultMap([
  { id: 'gate-a', pass: true },
  { id: 'gate-b', status: 'pass' }
]);
assert.equal(observedById.size, 2);
assert.equal(resolveObservedGatePass({ pass: false }), false);
assert.equal(resolveObservedGatePass({ status: 'pass' }), true);
assert.deepEqual(resolveObservedRedactionResult({ pass: false, misses: 3 }), { pass: false, misses: 3 });

assert.deepEqual(normalizeReportScope(null, 'lane', 'ci'), { scopeType: 'lane', scopeId: 'ci' });
assert.equal(toFixedDays(3 * 24 * 60 * 60 * 1000), 3);
assert.equal(toIsoDate('2026-03-19T05:00:00.000Z') instanceof Date, true);

console.log('USR matrix helper module test passed');
