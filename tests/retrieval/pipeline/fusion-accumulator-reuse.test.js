#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fuseRankedHits } from '../../../src/retrieval/pipeline/fusion.js';
import { createScoreBufferPool } from '../../../src/retrieval/pipeline/score-buffer.js';

const { cases } = JSON.parse(await fs.readFile(
  new URL('../../fixtures/retrieval/fusion-accumulator.json', import.meta.url), 'utf8'));
const fields = ['idx', 'score', 'scoreType', 'sparseScore', 'annScore', 'annSource', 'sparseType', 'blendInfo'];
const pool = createScoreBufferPool({ maxBuffers: 1, maxEntries: 128 });
for (const { name, input, expected } of cases) {
  const savedInput = structuredClone(input);
  for (const hit of [...input.bmHits, ...input.annHits]) Object.freeze(hit);
  Object.freeze(input.bmHits);
  Object.freeze(input.annHits);
  assert.deepEqual(fuseRankedHits(input), expected, `${name}: unchanged original fusion output`);
  const buffer = pool.acquire({ fields, capacity: input.bmHits.length + input.annHits.length });
  const actual = fuseRankedHits({ ...input, scoreBuffer: buffer });
  assert.equal(actual.useRrf, expected.useRrf);
  const materialized = buffer.entries.slice(0, buffer.count).map(({ __index, ...entry }) => entry);
  assert.deepEqual(materialized, expected.scored, `${name}: pooled output retains the same scores and details`);
  pool.release(buffer);
  assert.deepEqual(input, savedInput, `${name}: shared input hits remain immutable`);
}

const visits = [];
const observedInput = {
  ...cases[0].input,
  bmHits: [{ get idx() { visits.push('sparse-id'); return 1; },
    get score() { visits.push('sparse-score'); return 2; } }],
  annHits: [{ get idx() { visits.push('ann-id'); return 1; },
    get sim() { visits.push('ann-score'); return 0.5; } }]
};
const observed = fuseRankedHits(observedInput);
assert.deepEqual(visits, ['sparse-id', 'sparse-score', 'ann-id', 'ann-score', 'sparse-score']);
assert.equal(observed.scored[0].sparseScore, 2);
assert.equal(observed.scored[0].annScore, 0.5);

// Observe only the private fusion accumulator's records, not rank-number maps.
const records = new Set();
const originalSet = Map.prototype.set;
let accumulatorWrites = 0;
try {
  Map.prototype.set = function (key, value) {
    if (value && typeof value === 'object' && Object.hasOwn(value, 'bm25')
      && Object.hasOwn(value, 'fts') && Object.hasOwn(value, 'ann') && Object.hasOwn(value, 'annSource')) {
      records.add(value);
      accumulatorWrites += 1;
    }
    return originalSet.call(this, key, value);
  };
  const input = { ...cases[0].input,
    bmHits: Array.from({ length: 64 }, (_, idx) => ({ idx, score: idx + 1 })),
    annHits: Array.from({ length: 64 }, (_, idx) => ({ idx, sim: idx / 64 })) };
  const result = fuseRankedHits(input);
  assert.equal(result.scored.length, 64);
} finally {
  Map.prototype.set = originalSet;
}
assert.equal(records.size, 64, '128 contributions share 64 document-owned accumulators');
assert.equal(accumulatorWrites, 64, 'existing accumulator updates do not replace its Map entry');
console.log(`Fusion accumulator reuse passed: ${cases.length} original score/detail snapshots,128 contributions share64 records`);
