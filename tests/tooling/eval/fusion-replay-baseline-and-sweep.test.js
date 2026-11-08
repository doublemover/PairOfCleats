import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { stableStringify } from '../../../src/shared/stable-json.js';
import { captureFusionReplay, replayFusionRecord } from '../../../src/retrieval/evaluation/fusion-replay.js';
import { sweepFusionReplays, fusionReplaySplit } from '../../../src/retrieval/evaluation/fusion-sweep.js';
import { evaluateDatasetFusionReplay } from '../../../tools/eval/fusion-replay.js';
import { captureFusionFixture, fusionFixtureInput } from '../../helpers/fusion-replay-fixture.js';
import { rankDenseVectors } from '../../../src/retrieval/rankers.js';

const seal = record => {
  const { recordKey, ...body } = record;
  return { ...body, recordKey: createHash('sha256').update(stableStringify(body)).digest('hex') };
};
for (const change of [() => {}, input => { input.fusionInput.annHits = []; },
  input => { input.fusionInput.annHits[1].sim = 1; input.fusionInput.annHits[1].rawDistance = 0; },
  input => { input.fusionInput.bmHits = []; }, input => { input.fusionInput.bmHits = []; input.fusionInput.annHits = []; },
  input => { input.fusionInput.rrfEnabled = true; input.fusionInput.blendEnabled = false; },
  input => { input.rankInput.symbolBoostEnabled = true; input.rankInput.phraseNgramSet = new Set(['query']);
    input.rankInput.getPhraseMatchInfo = (_, id) => ({ matches: id === 1 ? 2 : 0 }); },
  input => { input.rankInput.graphRankingConfig = { enabled: true, weights: { degree: 0.2, proximity: 0.1 } };
    input.rankInput.idx.graphRelations = { callGraph: { nodes: [] }, usageGraph: { nodes: [] } }; }
]) {
  const input = fusionFixtureInput(); change(input);
  const record = await captureFusionReplay(input);
  assert.deepEqual(replayFusionRecord(record).results, record.baseline, 'saved baseline matches actual production gate/boost/tie/selection output');
  assert.deepEqual(replayFusionRecord(record, { boosts: true, diversity: true }).results, record.baseline);
}
const overlap = fusionFixtureInput('overlap', { overlap: true });
overlap.rankInput.searchTopN = 2; overlap.rankInput.topkSlack = 1;
overlap.fusionInput.bmHits[1].score = 9.5;
const overlapRecord = await captureFusionReplay(overlap);
assert.deepEqual(replayFusionRecord(overlapRecord).results, overlapRecord.baseline);
const { input, record } = await captureFusionFixture();
const denseInput = fusionFixtureInput('actual-dense-score-space');
denseInput.rankInput.idx.denseVec = { vectors: denseInput.evaluationRecord.rows.map(row => row.stored),
  dims: 2, minVal: -1, maxVal: 1, levels: 3, scale: 1 };
denseInput.fusionInput.annHits = rankDenseVectors(denseInput.rankInput.idx, [1, 0], 3, null);
assert.equal(denseInput.fusionInput.annHits[0].scoreSpace.kind, 'dot-product');
const denseRecord = await captureFusionReplay(denseInput);
assert.deepEqual(replayFusionRecord(denseRecord).results, denseRecord.baseline,
  'the real stored-dense ranker score-space contract is admitted without relabeling its metric');
const mutable = fusionFixtureInput('capture-borrowed-inputs');
const capturePending = captureFusionReplay(mutable);
mutable.rankInput.meta[0].name = 'changed after capture started';
mutable.fusionInput.bmHits[0].score = 999;
mutable.rankInput.idx.graphRelations = { changed: true };
const ownedCapture = await capturePending;
assert.equal(ownedCapture.candidates.find(row => row.idx === 0).chunk.name, 'function0');
assert.equal(ownedCapture.channels.sparse[0].score, 10);
assert.equal(ownedCapture.graphRelations, null, 'oracle awaits cannot mix later shared inputs into the saved generation');
assert.deepEqual(replayFusionRecord(ownedCapture).results, ownedCapture.baseline);
const wrongQuery = fusionFixtureInput(); wrongQuery.rankInput.query = 'different query text';
await assert.rejects(captureFusionReplay(wrongQuery), /query text identity/);
assert.throws(() => replayFusionRecord(record, { model: 'unregistered-policy' }), /policy fields/);
const fixed = replayFusionRecord(record, { mode: 'fixed-missing', sparseWeight: 0, denseWeight: 1 });
assert.equal(fixed.results[0].key, input.evaluationRecord.rows[1].key);
assert.equal(fixed.missingness.union, 3, 'fixed missing-channel baseline retains zero-weight-only union members');
assert.equal(fixed.missingness.missingDense, 1);
const noBoost = replayFusionRecord(record, { boosts: false, diversity: false });
assert.equal(noBoost.results[0].key, record.baseline[0].key);
const invalidSpace = structuredClone(record); invalidSpace.channels.dense[0].scoreSpace.metric = 'l2';
assert.throws(() => replayFusionRecord(seal(invalidSpace)), /score space/);
for (const mutate of [value => { value.policy = 'f'.repeat(64); }, value => { value.channels.dense[0].sim = Infinity; },
  value => { value.provenance.embeddingKey = 'f'.repeat(64); }, value => { value.provenance.corpus.generation = 'f'.repeat(64); }]) {
  const changed = structuredClone(record); mutate(changed);
  assert.throws(() => replayFusionRecord(changed), { code: 'ERR_FUSION_REPLAY' });
}
const seed = 'tiny-known-optimum', records = [], splitCounts = { train: 0, dev: 0, test: 0 };
for (let index = 0; Object.values(splitCounts).some(count => count < 2); index++) {
  const captured = await captureFusionFixture(`split-${index}`), split = fusionReplaySplit(captured.record.provenance.queryKey, seed);
  if (splitCounts[split] >= 2) continue;
  splitCounts[split]++; records.push(captured.record);
}
const grid = [{ mode: 'current' }, { mode: 'blend', sparseWeight: 0, denseWeight: 1 },
  { mode: 'rrf', rrfK: 10, sparseDepth: 1, denseDepth: 2, boosts: false, diversity: false }];
const receipt = await sweepFusionReplays({ records, grid, seed });
assert.equal(receipt.complete, true); assert.equal(receipt.selected.policy.mode, 'blend');
assert.equal(receipt.metrics.selectedTest.ndcg, 1);
assert.equal(receipt.metrics.baseline.dev.ndcg, 0);
assert.equal(receipt.metrics.pairedTest.ndcg.queries, 2);
assert.equal(receipt.metrics.pairedTest.ndcg.meanDifference, 1);
const clusterQuality = receipt.metrics.clusteredPairedTest.ndcg;
assert.equal(clusterQuality.complete, true); assert.equal(clusterQuality.estimates.completePairs, 2);
assert.equal(clusterQuality.estimates.repositoryMacro.meanDifference, 1);
assert.equal(clusterQuality.estimates.clusters, 1);
assert.equal(clusterQuality.estimates.repositoryMacro.interval95, null, 'one saved corpus cannot claim repository-level uncertainty from its query count');
assert.equal(clusterQuality.estimates.inference, 'insufficient-independent-clusters');
assert.equal(clusterQuality.decision, null);
const corruptBaseline = structuredClone(records); corruptBaseline[0].baseline[0].score += 1; corruptBaseline[0] = seal(corruptBaseline[0]);
await assert.rejects(sweepFusionReplays({ records: corruptBaseline, grid, seed }), /baseline parity/);
const heldOutChanged = records.map(value => {
  const row = structuredClone(value);
  if (fusionReplaySplit(row.provenance.queryKey, seed) === 'test') {
    const a = input.evaluationRecord.rows[0].key;
    row.judgments = row.judgments.map(judgment => ({ ...judgment, relevance: judgment.key === a ? 4 : 0 }));
  }
  return seal(row);
});
const heldOut = await sweepFusionReplays({ records: heldOutChanged, grid, seed });
assert.equal(heldOut.selected.key, receipt.selected.key, 'test grades cannot affect the frozen selection key or parameters');
assert.equal(heldOut.metrics.selectedTest.ndcg, 0);
const resumed = await sweepFusionReplays({ records: [...records].reverse(), grid: [...grid].reverse(), seed,
  resumeKey: receipt.checkpoint.key });
assert.equal(resumed.selected.key, receipt.selected.key, 'resume restarts deterministically with order-independent input identity');
await assert.rejects(sweepFusionReplays({ records: heldOutChanged, grid, seed, resumeKey: receipt.checkpoint.key }), /checkpoint/);
const controller = new AbortController(); controller.abort();
await assert.rejects(captureFusionReplay({ ...fusionFixtureInput(), signal: controller.signal }), { name: 'AbortError' });
for (const options of [{ signal: controller.signal }, { limits: { work: 1 } }, { limits: { outputBytes: 256 } },
  { limits: { records: 1 } }, { limits: { configurations: 1 } }]) {
  const partial = await sweepFusionReplays({ records, grid, seed, ...options });
  assert.equal(partial.complete, false); assert.equal(partial.selected, null); assert.equal(partial.metrics, null);
  if (options.limits?.outputBytes) assert(Buffer.byteLength(JSON.stringify(partial)) <= 256);
}
const during = new AbortController(); setImmediate(() => during.abort());
const interrupted = await sweepFusionReplays({ records, grid, seed, signal: during.signal });
assert.equal(interrupted.complete, false); assert.equal(interrupted.reason, 'cancelled'); assert.equal(interrupted.selected, null);
await assert.rejects(sweepFusionReplays({ records, grid, seed, expected: {
  embeddingKey: '0'.repeat(64), sourceDigest: record.provenance.corpus.sourceDigest, generation: record.provenance.corpus.generation } }), /model or corpus/);
const report = await evaluateDatasetFusionReplay({ cases: records.map(row => ({ query: `query ${row.provenance.queryId}`,
  fusionReplay: row, fusionReplayGrid: grid, fusionReplaySeed: seed })) });
assert.equal(report.currentSearchEvidence, false); assert.equal(report.receipt.selected.key, receipt.selected.key);
console.log('fusion replay baseline, bounded split sweep, provenance, partial/resume and held-out isolation assertions complete');
