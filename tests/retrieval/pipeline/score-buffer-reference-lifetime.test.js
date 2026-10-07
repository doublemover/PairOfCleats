#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createScoreBufferPool } from '../../../src/retrieval/pipeline/score-buffer.js';
import { fuseRankedHits } from '../../../src/retrieval/pipeline/fusion.js';
import { runRankStage } from '../../../src/retrieval/pipeline/rank-stage.js';

const fields = [
  'idx', 'score', 'scoreType', 'sparseScore', 'annScore', 'annSource', 'sparseType', 'blendInfo'
];
const pool = createScoreBufferPool({ maxBuffers: 1, maxEntries: 128 });
const buffer = pool.acquire({ fields, capacity: 128 });
const numericArrays = { ...buffer.numericArrays };
const hits = Array.from({ length: 64 }, (_, idx) => ({ idx, score: idx + 1 }));
const fuse = (bmHits, scoreBuffer) => fuseRankedHits({
  bmHits,
  annHits: [],
  sparseType: 'bm25',
  annSource: null,
  rrfEnabled: false,
  rrfK: 60,
  blendEnabled: true,
  blendSparseWeight: 1,
  blendAnnWeight: 1,
  fieldWeightsEnabled: false,
  scoreBuffer
});

// Real fusion creates a transient blend object for each active score entry.
const plainFusion = fuse(hits, null).scored;
fuse(hits, buffer);
assert.equal(buffer.count, 64);
assert.deepEqual(buffer.entries.slice(0, buffer.count).map(({ __index, ...entry }) => entry), plainFusion);
const retiredEntries = buffer.entries.slice(0, buffer.count);
const firstBlend = retiredEntries[0].blendInfo;
assert.ok(retiredEntries.every((entry) => entry.blendInfo !== null));
pool.release(buffer);
assert.equal(buffer.count, 0);
assert.ok(retiredEntries.every((entry) => entry.blendInfo === null), 'idle pool must release fusion objects');
assert.equal(firstBlend.score, plainFusion[0].blendInfo.score, 'release must not mutate referenced payloads');

// A smaller subsequent query reuses storage without retaining the previous tail.
const reused = pool.acquire({ fields, capacity: 1 });
assert.equal(reused, buffer);
assert.equal(reused.numericArrays.idx, numericArrays.idx);
assert.equal(reused.numericArrays.score, numericArrays.score);
fuse(hits.slice(0, 1), reused);
assert.equal(reused.count, 1);
assert.ok(retiredEntries.slice(1).every((entry) => entry.blendInfo === null));

// Retiring one active row must not visit unrelated allocated capacity.
Object.defineProperty(reused.entries, 100, {
  configurable: true,
  get() { throw new Error('inactive capacity was visited'); }
});
pool.release(reused);
assert.equal(reused.entries[0].blendInfo, null);
delete reused.entries[100];
assert.equal(pool.stats.allocations, 1);
assert.equal(pool.stats.reuses, 1);

// Explicit reset retires references too, including a payload independent of fusion.
const resetBuffer = pool.acquire({ fields: ['idx', 'score', 'payload'], capacity: 2 });
const payload = { text: 'kept by the caller' };
const borrowed = resetBuffer.push({ idx: 1, score: 0.5, payload });
assert.equal(resetBuffer.reset(), resetBuffer);
assert.equal(resetBuffer.count, 0);
assert.equal(borrowed.payload, null);
assert.deepEqual(payload, { text: 'kept by the caller' });
pool.release(resetBuffer);

const rrfBuffer = pool.acquire({ fields, capacity: 2 });
const rrfInput = {
  bmHits: hits.slice(0, 2),
  annHits: [{ idx: 1, sim: 0.9 }],
  sparseType: 'bm25',
  annSource: 'js',
  rrfEnabled: true,
  rrfK: 60,
  blendEnabled: false
};
const plainRrf = fuseRankedHits(rrfInput).scored;
fuseRankedHits({ ...rrfInput, scoreBuffer: rrfBuffer });
assert.deepEqual(rrfBuffer.entries.slice(0, rrfBuffer.count).map(({ __index, ...entry }) => entry), plainRrf);
assert.equal(rrfBuffer.entries[0].scoreType, 'rrf');
pool.release(rrfBuffer);
assert.ok(rrfBuffer.entries.slice(0, 2).every((entry) => entry.blendInfo === null));

// Ranking hands off independent output before the pipeline releases its buffer.
const outputPool = createScoreBufferPool({ maxBuffers: 1, maxEntries: 128 });
const outputBuffer = outputPool.acquire({ fields, capacity: 64 });
const meta = hits.map(({ idx }) => ({ id: idx, file: `src/${idx}.js` }));
const rank = (fusedScores) => runRankStage({
  idx: {},
  meta,
  fusedScores,
  useRrf: false,
  abortIfNeeded: () => {},
  searchTopN: 2,
  topkSlack: 8,
  poolSnapshotStart: { candidate: {}, score: {} },
  poolSnapshot: () => ({ candidate: {}, score: {} }),
  rankMetrics: {},
  explain: true,
  matchesQueryAst: () => true,
  graphRankingConfig: { enabled: false },
  blendEnabled: true
});
fuse(hits, outputBuffer);
const results = rank(outputBuffer);
assert.deepEqual(results, rank(plainFusion), 'pooled and ordinary fusion must rank identically');
assert.ok(results[0].scoreBreakdown.blend);
const savedResults = structuredClone(results);
outputPool.release(outputBuffer);
assert.equal(outputBuffer.entries[0].blendInfo, null);
const nextOutputBuffer = outputPool.acquire({ fields, capacity: 1 });
fuse(hits.slice(0, 1), nextOutputBuffer);
rank(nextOutputBuffer);
outputPool.release(nextOutputBuffer);
assert.deepEqual(results, savedResults, 'release and reuse must preserve previously returned output');
assert.equal(outputPool.stats.allocations, 1);
assert.equal(outputPool.stats.reuses, 1);

console.log('score buffer reference lifetime test passed: 64 transient fusion objects retired, storage reused');
