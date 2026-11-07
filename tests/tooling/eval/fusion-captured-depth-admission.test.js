import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { stableStringify } from '../../../src/shared/stable-json.js';
import { captureFusionReplay, replayFusionRecord, FUSION_REPLAY_VERSION } from '../../../src/retrieval/evaluation/fusion-replay.js';
import { fusionChannelPrefixHash } from '../../../src/retrieval/evaluation/fusion-channel-coverage.js';
import { sweepFusionReplays, fusionReplaySplit } from '../../../src/retrieval/evaluation/fusion-sweep.js';
import { fusionFixtureInput } from '../../helpers/fusion-replay-fixture.js';

const seal = value => {
  const { recordKey, ...body } = value;
  return { ...body, recordKey: createHash('sha256').update(stableStringify(body)).digest('hex') };
};
const shortInput = fusionFixtureInput('short-prefix');
const short = await captureFusionReplay(shortInput);
assert.equal(short.schemaVersion, FUSION_REPLAY_VERSION);
assert.equal(short.channelCoverage.sparse.requestedDepth, null, 'capture cannot invent an unrecorded retrieval request');
assert.equal(short.channelCoverage.sparse.exhaustion, null);
for (const channel of ['sparse', 'dense']) {
  for (const depth of [0, 2]) {
    const receipt = replayFusionRecord(short, { [channel + 'Depth']: depth });
    assert.equal(receipt.depthAvailability[channel].requestedDepth, depth);
    assert.equal(receipt.depthAvailability[channel].effectiveDepth, depth);
    assert.equal(receipt.depthAvailability[channel].unseenTail, 'unknown');
  }
  for (const depth of [3, 100]) assert.throws(() => replayFusionRecord(short, { [channel + 'Depth']: depth }), /without exhausted-channel evidence/);
}
const completeInput = fusionFixtureInput('complete-enumeration');
const witness = channel => {
  const hits = channel === 'sparse' ? completeInput.fusionInput.bmHits : completeInput.fusionInput.annHits;
  return { requestedDepth: 10, exhaustion: { state: 'exhausted', basis: 'capture-owner-complete-enumeration',
    eligibleCount: hits.length, prefixHash: fusionChannelPrefixHash(hits.map(hit => completeInput.idToSourceKey.get(hit.idx))),
    queryKey: completeInput.evaluationRecord.observed.provenance.queryKey,
    generation: completeInput.evaluationRecord.corpus.generation, sourceDigest: completeInput.evaluationRecord.corpus.sourceDigest } };
};
completeInput.channelCoverage = { sparse: witness('sparse'), dense: witness('dense') };
const pending = captureFusionReplay(completeInput);
completeInput.channelCoverage.sparse.exhaustion.eligibleCount = 99;
const complete = await pending;
assert.equal(complete.channelCoverage.sparse.exhaustion.eligibleCount, 2, 'the receipt is captured before oracle awaits');
const exhausted = replayFusionRecord(complete, { sparseDepth: 100, denseDepth: 100 });
assert.deepEqual(exhausted.results, complete.baseline);
for (const channel of ['sparse', 'dense']) {
  assert.equal(exhausted.depthAvailability[channel].effectiveDepth, 2);
  assert.equal(exhausted.depthAvailability[channel].requestedDepth, 100);
  assert.equal(exhausted.depthAvailability[channel].availability, 'exhausted-channel');
}
for (const mutate of [value => { value.channelCoverage.sparse.capturedCount = 3; },
  value => { value.channelCoverage.sparse.exhaustion.queryKey = '0'.repeat(64); },
  value => { value.channelCoverage.sparse.exhaustion.prefixHash = '0'.repeat(64); },
  value => { value.channelCoverage.sparse.exhaustion.generation = '0'.repeat(64); },
  value => { value.schemaVersion = 1; }]) {
  const invalid = structuredClone(complete); mutate(invalid);
  assert.throws(() => replayFusionRecord(seal(invalid)), { code: 'ERR_FUSION_REPLAY' });
}
const deeperInput = id => {
  const input = fusionFixtureInput(id);
  input.fusionInput.bmHits.push({ idx: 2, score: 0.5 });
  input.evaluationRecord.observed.sparseKeys = input.evaluationRecord.rows.map(row => row.key);
  input.evaluationRecord.observed.judgments = input.evaluationRecord.rows.map((row, index) => ({ key: row.key, relevance: index === 2 ? 4 : 0 }));
  input.rankInput.symbolBoostEnabled = true; input.rankInput.symbolBoostDefinitionWeight = 1;
  input.rankInput.symbolBoostExportWeight = 100; input.rankInput.isExportedChunk = chunk => chunk.file === 'c.js';
  input.rankInput.topkSlack = 2;
  return input;
};
const deep = await captureFusionReplay(deeperInput('actual-rank-three'));
const sparseOnly = { mode: 'blend', sparseWeight: 1, denseWeight: 0, denseDepth: 0, boosts: true };
assert.equal(replayFusionRecord(deep, { ...sparseOnly, sparseDepth: 2 }).results[0].key, shortInput.evaluationRecord.rows[0].key);
assert.equal(replayFusionRecord(deep, { ...sparseOnly, sparseDepth: 3 }).results[0].key, shortInput.evaluationRecord.rows[2].key,
  'actually captured rank three changes the winner; relabeling top two cannot');
for (const records of [[short, deep], [deep, short]]) {
  await assert.rejects(sweepFusionReplays({ records, grid: [{ ...sparseOnly, sparseDepth: 3 }], seed: 'mixed-depths' }),
    /without exhausted-channel evidence/, 'unsupported query depth cannot silently drop a query or clip its policy');
}
const records = [], present = new Set(), seed = 'qualified-depth-selection';
for (let index = 0; present.size < 3; index++) {
  const record = await captureFusionReplay(deeperInput('depth-split-' + index));
  const split = fusionReplaySplit(record.provenance.queryKey, seed);
  if (!present.has(split)) { present.add(split); records.push(record); }
}
const sweep = await sweepFusionReplays({ records, seed,
  grid: [{ ...sparseOnly, sparseDepth: 2 }, { ...sparseOnly, sparseDepth: 3 }] });
assert.equal(sweep.complete, true); assert.equal(sweep.selected.policy.sparseDepth, 3);
assert.equal(sweep.metrics.selectedTest.ndcg, 1);
assert.ok(sweep.selected.depthPolicy.includes('owner-exhaustion'));
console.log('Fusion replay refuses unseen ranks, binds explicit exhaustion, and selects deeper policy only with captured evidence.');
