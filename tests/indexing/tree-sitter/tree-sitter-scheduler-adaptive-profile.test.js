#!/usr/bin/env node
import assert from 'node:assert/strict';

import { applyTestEnv } from '../../helpers/test-env.js';
import { mergeTreeSitterSchedulerAdaptiveProfile } from '../../../src/index/build/tree-sitter-scheduler/adaptive-profile.js';

applyTestEnv({ testing: '1' });

const initial = new Map([
  ['cpp', { rowsPerSec: 1000, samples: 2, updatedAt: null }]
]);

const merged = mergeTreeSitterSchedulerAdaptiveProfile(initial, [
  { baseGrammarKey: 'cpp', rows: 4000, durationMs: 1000, at: '2026-02-21T00:00:00.000Z' },
  { baseGrammarKey: 'java', rows: 2000, durationMs: 1000 }
]);

assert.ok(merged.has('cpp'), 'expected existing grammar entry to persist');
assert.ok(merged.has('java'), 'expected new grammar entry to be created');
const cpp = merged.get('cpp');
assert.ok(cpp.rowsPerSec > 1000 && cpp.rowsPerSec < 4000, 'expected EMA merge for existing grammar');
assert.equal(cpp.samples, 3, 'expected sample count increment');

console.log('tree-sitter scheduler adaptive profile test passed');
