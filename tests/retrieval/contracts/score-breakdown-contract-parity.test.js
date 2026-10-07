#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createScoreBreakdownHits,
  EXPECTED_SCORE_BREAKDOWN_KEYS
} from './score-breakdown-fixture.js';

const { codeHit, proseHit } = await createScoreBreakdownHits();

assert.ok(codeHit?.scoreBreakdown, 'expected code hit scoreBreakdown');
assert.ok(proseHit?.scoreBreakdown, 'expected prose hit scoreBreakdown');
assert.deepEqual(
  Object.keys(codeHit.scoreBreakdown),
  EXPECTED_SCORE_BREAKDOWN_KEYS,
  'expected code scoreBreakdown contract keys'
);
assert.deepEqual(
  Object.keys(proseHit.scoreBreakdown),
  EXPECTED_SCORE_BREAKDOWN_KEYS,
  'expected prose scoreBreakdown contract keys'
);
assert.equal(codeHit.scoreBreakdown.schemaVersion, 1, 'expected schema version in code hit');
assert.equal(proseHit.scoreBreakdown.schemaVersion, 1, 'expected schema version in prose hit');

console.log('score breakdown contract parity test passed');
