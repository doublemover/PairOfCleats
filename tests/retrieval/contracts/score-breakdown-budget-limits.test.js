#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyScoreBreakdownBudget } from '../../../src/retrieval/output/score-breakdown.js';

const oversized = {
  schemaVersion: 1,
  selected: { type: 'blend', score: 42 },
  sparse: {
    type: 'fts',
    score: 7,
    match: '"alpha"',
    values: Array.from({ length: 20 }, (_, i) => ({ k: i, text: `value-${i}` }))
  },
  ann: {
    score: 0.75,
    source: 'sqlite-vec',
    traces: Array.from({ length: 20 }, (_, i) => i)
  },
  rrf: { score: 1.5 },
  blend: { score: 2.5 },
  symbol: { factor: 1.1 },
  phrase: { matches: 4 },
  graph: { score: 0.2 }
};

const budgeted = applyScoreBreakdownBudget(oversized, {
  maxBytes: 500,
  maxFields: 4,
  maxExplainItems: 3
});

const assertArrayBudget = (value) => {
  if (Array.isArray(value)) {
    assert.ok(value.length <= 3, 'expected explain arrays to respect maxExplainItems');
    value.forEach(assertArrayBudget);
    return;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach(assertArrayBudget);
  }
};

assert.ok(Object.keys(budgeted).length <= 4, 'expected top-level fields to respect maxFields budget');
assertArrayBudget(budgeted);
assert.ok(
  Buffer.byteLength(JSON.stringify(budgeted), 'utf8') <= 500,
  'expected score breakdown to respect maxBytes budget'
);

console.log('score breakdown budget limits test passed');
