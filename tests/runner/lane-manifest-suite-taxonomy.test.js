#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadLaneManifestConfig,
  loadOrderedLaneManifest
} from './lane-manifests.js';
import {
  buildSuiteCategorySummary,
  inferSuiteCategory,
  TEST_SUITE_CATEGORIES
} from './suite-taxonomy.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const config = await loadLaneManifestConfig({ root: ROOT });
const ciLiteManifest = await loadOrderedLaneManifest({ root: ROOT, lane: 'ci-lite', config });
const ciLongManifest = await loadOrderedLaneManifest({ root: ROOT, lane: 'ci-long', config });

for (const manifest of [ciLiteManifest, ciLongManifest]) {
  assert.ok(manifest?.suiteCategorySummary, `expected suiteCategorySummary for ${manifest?.lane || 'unknown lane'}`);
  const laneConfig = config.orderedLanes.get(manifest.lane);
  const orderIds = (await fs.readFile(laneConfig.orderFilePath, 'utf8'))
    .split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  assert.deepEqual(manifest.tests.map((entry) => entry.id), orderIds,
    `expected ${manifest.lane} to preserve its complete ordered membership`);
  assert.equal(new Set(orderIds).size, orderIds.length, `duplicate ID in ${manifest.lane}`);
  assert.deepEqual(manifest.tests.map((entry) => entry.order), orderIds.map((_, index) => index + 1));
  for (const entry of manifest.tests || []) {
    assert.ok(entry.suiteCategory, `expected suiteCategory for ${entry.id}`);
    assert.ok(entry.suiteCategoryReason, `expected suiteCategoryReason for ${entry.id}`);
    assert.ok(TEST_SUITE_CATEGORIES.includes(entry.suiteCategory), `unknown category for ${entry.id}`);
    const expected = inferSuiteCategory({ id: entry.id, lane: manifest.lane });
    assert.equal(entry.suiteCategory, expected.category, `stale category for ${entry.id}`);
    assert.equal(entry.suiteCategoryReason, expected.reason, `stale category reason for ${entry.id}`);
  }
  assert.deepEqual(manifest.suiteCategorySummary, buildSuiteCategorySummary(manifest.tests),
    `expected ${manifest.lane} summary to match its actual entries`);
  assert.equal(Object.values(manifest.suiteCategorySummary).reduce((sum, count) => sum + count, 0),
    manifest.tests.length, `expected ${manifest.lane} summary to count every test once`);
}

assert.ok((ciLiteManifest?.suiteCategorySummary?.meta || 0) > 0, 'expected ci-lite to include meta suites');
assert.ok((ciLiteManifest?.suiteCategorySummary?.matrix || 0) > 0, 'expected ci-lite to include matrix suites');
assert.ok((ciLongManifest?.suiteCategorySummary?.['heavy-runtime'] || 0) > 0, 'expected ci-long to include heavy-runtime suites');
// Ordinary long-lane suites classify as heavy-runtime; matrix consolidation can
// legitimately leave no heroes. Validate actual classification/totals above
// rather than requiring a category mix that the taxonomy does not prescribe.

console.log('lane manifest suite taxonomy test passed');
