#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSearchTelemetry } from '../../../src/retrieval/cli/telemetry.js';
import {
  RESOURCE_GROWTH_THRESHOLDS,
  RESOURCE_WARNING_CODES,
  evaluateResourceGrowth,
  formatResourceGrowthWarning,
  readIndexArtifactBytes
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

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-op-resource-'));
const plainDir = path.join(tempRoot, 'plain');
const wrappedDir = path.join(tempRoot, 'wrapped');
const missingDir = path.join(tempRoot, 'missing');
await fs.mkdir(path.join(plainDir, 'pieces'), { recursive: true });
await fs.mkdir(path.join(wrappedDir, 'pieces'), { recursive: true });
await fs.mkdir(missingDir, { recursive: true });
await fs.writeFile(path.join(plainDir, 'pieces', 'manifest.json'), JSON.stringify({
  pieces: [
    { name: 'chunk_meta', bytes: 1234 },
    { name: 'token_postings', bytes: 4321 }
  ]
}));
await fs.writeFile(path.join(wrappedDir, 'pieces', 'manifest.json'), JSON.stringify({
  fields: {
    pieces: [
      { name: 'chunk_meta', bytes: 99 },
      { name: 'token_postings', bytes: 1 }
    ]
  }
}));
assert.equal(await readIndexArtifactBytes(plainDir), 5555, 'expected raw manifest piece bytes to be summed');
assert.equal(await readIndexArtifactBytes(wrappedDir), 100, 'expected wrapped manifest fields piece bytes to be summed');
assert.equal(await readIndexArtifactBytes(missingDir), null, 'expected missing manifest to return null bytes');
await fs.rm(tempRoot, { recursive: true, force: true });

console.log('ops resources basic growth warning test passed');
