#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createSearchTelemetry } from '../../../src/retrieval/cli/telemetry.js';
import {
  RESOURCE_GROWTH_THRESHOLDS,
  RESOURCE_WARNING_CODES,
  evaluateResourceGrowth,
  formatResourceGrowthWarning
} from '../../../src/shared/ops-resource-visibility.js';

const MiB = 1024 * 1024;

const abnormalIndexGrowth = evaluateResourceGrowth({
  baselineBytes: 100 * MiB,
  currentBytes: 420 * MiB,
  ratioThreshold: RESOURCE_GROWTH_THRESHOLDS.indexSizeRatio,
  deltaThresholdBytes: RESOURCE_GROWTH_THRESHOLDS.indexSizeDeltaBytes
});
assert.equal(abnormalIndexGrowth.abnormal, true, 'expected controlled abnormal index growth to trigger warning threshold');
const warningLine = formatResourceGrowthWarning({
  code: RESOURCE_WARNING_CODES.INDEX_SIZE_GROWTH_ABNORMAL,
  component: 'indexing',
  metric: 'code.artifact_bytes',
  growth: abnormalIndexGrowth,
  nextAction: 'profile'
});
assert.ok(warningLine.includes('code=op_resource_index_growth_abnormal'), 'expected warning code in output line');

const normalIndexGrowth = evaluateResourceGrowth({
  baselineBytes: 200 * MiB,
  currentBytes: 260 * MiB,
  ratioThreshold: RESOURCE_GROWTH_THRESHOLDS.indexSizeRatio,
  deltaThresholdBytes: RESOURCE_GROWTH_THRESHOLDS.indexSizeDeltaBytes
});
assert.equal(normalIndexGrowth.abnormal, false, 'expected normal index growth to stay below warning threshold');
const ratioOnlyGrowth = evaluateResourceGrowth({
  baselineBytes: 50 * MiB,
  currentBytes: 120 * MiB,
  ratioThreshold: RESOURCE_GROWTH_THRESHOLDS.indexSizeRatio,
  deltaThresholdBytes: RESOURCE_GROWTH_THRESHOLDS.indexSizeDeltaBytes
});
assert.equal(
  ratioOnlyGrowth.abnormal,
  false,
  'expected ratio-only growth to remain below warning threshold when delta gate is not met'
);

const abnormalWarnings = [];
let abnormalReads = 0;
const abnormalTelemetry = createSearchTelemetry({
  readRss: () => ([120 * MiB, 340 * MiB][Math.min(abnormalReads++, 1)])
});
abnormalTelemetry.emitResourceWarnings({
  warn: (message) => abnormalWarnings.push(String(message))
});
abnormalTelemetry.emitResourceWarnings({
  warn: (message) => abnormalWarnings.push(String(message))
});
assert.equal(abnormalWarnings.length, 1, 'expected controlled abnormal retrieval rss growth to emit warning');
assert.ok(
  abnormalWarnings[0].includes(RESOURCE_WARNING_CODES.RETRIEVAL_MEMORY_GROWTH_ABNORMAL),
  'expected retrieval memory warning code in emitted warning'
);

const normalWarnings = [];
let normalReads = 0;
const normalTelemetry = createSearchTelemetry({
  readRss: () => ([120 * MiB, 150 * MiB][Math.min(normalReads++, 1)])
});
normalTelemetry.emitResourceWarnings({
  warn: (message) => normalWarnings.push(String(message))
});
assert.equal(normalWarnings.length, 0, 'expected normal retrieval rss growth to remain below warning thresholds');

console.log('ops resources basic growth warning test passed');
