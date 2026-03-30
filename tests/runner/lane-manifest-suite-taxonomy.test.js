#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadLaneManifestConfig,
  loadOrderedLaneManifest
} from './lane-manifests.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const config = await loadLaneManifestConfig({ root: ROOT });
const ciLiteManifest = await loadOrderedLaneManifest({ root: ROOT, lane: 'ci-lite', config });
const ciLongManifest = await loadOrderedLaneManifest({ root: ROOT, lane: 'ci-long', config });

for (const manifest of [ciLiteManifest, ciLongManifest]) {
  assert.ok(manifest?.suiteCategorySummary, `expected suiteCategorySummary for ${manifest?.lane || 'unknown lane'}`);
  for (const entry of manifest.tests || []) {
    assert.ok(entry.suiteCategory, `expected suiteCategory for ${entry.id}`);
    assert.ok(entry.suiteCategoryReason, `expected suiteCategoryReason for ${entry.id}`);
  }
}

assert.ok((ciLiteManifest?.suiteCategorySummary?.meta || 0) > 0, 'expected ci-lite to include meta suites');
assert.ok((ciLiteManifest?.suiteCategorySummary?.matrix || 0) > 0, 'expected ci-lite to include matrix suites');
assert.ok((ciLongManifest?.suiteCategorySummary?.['heavy-runtime'] || 0) > 0, 'expected ci-long to include heavy-runtime suites');
assert.ok((ciLongManifest?.suiteCategorySummary?.hero || 0) > 0, 'expected ci-long to include hero suites');

console.log('lane manifest suite taxonomy test passed');
