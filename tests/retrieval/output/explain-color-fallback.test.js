#!/usr/bin/env node
import assert from 'node:assert';
import { formatScoreBreakdown } from '../../../src/retrieval/output/explain.js';

const breakdown = {
  selected: { type: 'bm25', score: 1.23 }
};
const lines = formatScoreBreakdown(breakdown, {});
assert(lines.length === 1, 'expected a score breakdown line');
assert(lines[0].includes('Scores'), 'expected score label without color dependency');
console.log('explain color fallback test passed');
