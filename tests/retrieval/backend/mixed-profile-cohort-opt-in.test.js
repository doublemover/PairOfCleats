#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import { loadSearchIndexes } from '../../../src/retrieval/cli/load-indexes.js';
import {
  createMixedProfileFixture,
  createMixedProfileLoadOptions
} from '../../helpers/index-compatibility-fixture.js';

applyTestEnv();

const { rootDir } = await createMixedProfileFixture('poc-mixed-profile-opt-in-');

const warnings = [];
const originalWarn = console.warn;
console.warn = (message) => warnings.push(String(message || ''));

try {
  const loaded = await loadSearchIndexes(createMixedProfileLoadOptions(rootDir, {
    emitOutput: true,
    allowUnsafeMix: true
  }));

  assert.ok(loaded?.idxCode, 'expected code index to load with unsafe mix override');
  assert.ok(loaded?.idxProse, 'expected prose index to load with unsafe mix override');
} finally {
  console.warn = originalWarn;
}

assert.ok(
  warnings.some((entry) => entry.includes('--allow-unsafe-mix')),
  'expected warning describing unsafe mixed-cohort override'
);

console.log('mixed profile cohort opt-in test passed');
