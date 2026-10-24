import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { VECTOR_EVALUATION_VERSION } from '../../../src/contracts/schemas/vector-evaluation.js';
import { evaluateVectorOracles, admitVectorEvaluationRecord, vectorEvaluationSourceKey, vectorEvaluationCorpusDigest,
  vectorEvaluationEmbeddingKey, vectorEvaluationQueryKey, vectorEvaluationOriginalDigest } from '../../../src/retrieval/evaluation/vector-oracle.js';
import { evaluateDatasetVectorReplay } from '../../../tools/eval/vector-oracle.js';
import { compareVectorOracleQuality } from '../../../src/retrieval/evaluation/vector-quality.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const queryText = 'fixture query';
const sourceTexts = { 'a.js': 'alpha beta', 'b.js': 'alpha beta excluded', 'c.js': 'other excluded',
  'd.js': 'alpha beta', 'e.js': 'alpha beta', 'zero.js': 'other source' };
const source = file => ({ repoId: 'independent-fixture', mode: 'code', file, start: 0, end: (sourceTexts[file] || file).length,
  offsetUnit: 'utf16-code-unit', contentDigest: hash(sourceTexts[file] || file) });
const row = (file, original, stored) => ({ key: vectorEvaluationSourceKey(source(file)), source: source(file),
  presence: { code: original !== null || stored !== null, doc: false, merged: original !== null || stored !== null }, original, stored });
const make = () => {
  const value = { schemaVersion: VECTOR_EVALUATION_VERSION, kind: 'retrieval-vector-evaluation',
    corpus: { id: 'hand-enumerated', sourceDigest: '', generation: hash('generation-one') },
    embedding: { modelId: 'hand-enumerated-fp32', revision: 'a'.repeat(40), artifactDigest: hash('graph'), tokenizerDigest: hash('tokenizer'),
      dimensions: 2, normalize: false, metric: 'cosine', channel: 'merged', storage: { encoding: 'uint8-affine-v1', minVal: -1, maxVal: 1, levels: 3 } },
    query: { id: 'q1', textDigest: hash(queryText), filterDigest: hash('independently-admitted-all'), vector: [1, 0] },
    originals: { status: 'available', capture: 'provider-fp32', digest: '' },
    eligibility: { status: 'complete', method: 'hand-admitted', policyDigest: hash('hand-enumerated-policy'), admittedKeys: [] },
    rows: [row('a.js', [1, 0], [2, 1]), row('b.js', [0, 1], [1, 2]), row('c.js', [-1, 0], [0, 1]),
      row('d.js', [1, 0], [2, 1]), row('e.js', null, null), row('zero.js', [0, 0], [1, 1])],
    observed: { provenance: {}, eligibleKeys: [], sparseKeys: [], vectorKeys: [], finalKeys: [], judgments: [] } };
  value.eligibility.admittedKeys = value.rows.map(item => item.key);
  value.observed.eligibleKeys = [...value.eligibility.admittedKeys];
  value.observed.vectorKeys = value.rows.slice(0, 2).map(item => item.key);
  return seal(value);
};
const seal = value => {
  value.corpus.sourceDigest = vectorEvaluationCorpusDigest(value.rows);
  value.originals.digest = value.originals.status === 'unavailable' ? null : vectorEvaluationOriginalDigest(value.rows);
  value.observed.provenance = { sourceDigest: value.corpus.sourceDigest, generation: value.corpus.generation,
    embeddingKey: vectorEvaluationEmbeddingKey(value.embedding), queryKey: vectorEvaluationQueryKey(value) };
  return value;
};
for (const [metric, expected] of [['cosine', [1, 1, 0, 0, -1]], ['dot', [1, 1, 0, 0, -1]], ['l2-squared', [0, 0, -1, -2, -4]]]) {
  const record = make(); record.embedding.metric = metric; seal(record);
  const receipt = await evaluateVectorOracles(record, { k: 10 });
  assert.equal(receipt.complete, true); assert.equal(receipt.original.status, 'complete'); assert.equal(receipt.stored.status, 'complete');
  assert.deepEqual(receipt.original.results.map(item => item.score), expected, 'independent score agrees with hand-enumerated geometry');
  assert.deepEqual(receipt.stored.results.map(item => item.score), expected);
  const tieKeys = record.rows.filter(item => ['a.js', 'd.js'].includes(item.source.file)).map(item => item.key).sort();
  assert.deepEqual(receipt.original.results.slice(0, 2).map(item => item.key), tieKeys);
  assert.equal(receipt.metrics.annCandidateRecall.denominator, 5, 'fewer than k eligible present channels define the denominator');
  assert.equal(receipt.counts.absentChannelRows, 1);
  assert.equal(receipt.counts.storedRowsScored, 5, 'present zero vectors remain in the universe');
}
const three = make(); three.embedding.dimensions = 3; three.embedding.metric = 'dot';
three.embedding.storage = { encoding: 'uint8-affine-v1', minVal: -2, maxVal: 2, levels: 5 };
three.query.vector = [1, 2, -1]; three.rows = [row('three.js', [2, 1, -1], [4, 3, 1])];
three.eligibility.admittedKeys = [three.rows[0].key]; three.observed.eligibleKeys = [three.rows[0].key];
three.observed.vectorKeys = [three.rows[0].key]; seal(three);
assert.equal((await evaluateVectorOracles(three)).original.results[0].score, 5);
three.embedding.metric = 'l2-squared'; seal(three);
assert.equal((await evaluateVectorOracles(three)).stored.results[0].score, -2);
three.embedding.metric = 'dot'; three.embedding.normalize = true; seal(three);
assert(Math.abs((await evaluateVectorOracles(three)).original.results[0].score - 5 / 6) < 1e-6,
  'normalization follows the declared convention before independent dot scoring');

const filtered = make(), [a, b, c, d, absent] = filtered.rows;
filtered.eligibility.admittedKeys = filtered.rows.filter(item => sourceTexts[item.source.file].includes('alpha beta')
  && !sourceTexts[item.source.file].includes('excluded')).map(item => item.key);
filtered.query.filterDigest = hash('phrase:"alpha beta" AND NOT excluded:true');
filtered.eligibility.policyDigest = hash('hand-admitted phrase and negation facts');
filtered.observed.eligibleKeys = [a.key, b.key, absent.key]; filtered.observed.vectorKeys = [b.key, c.key]; filtered.observed.sparseKeys = [a.key];
filtered.observed.finalKeys = [c.key, b.key, a.key];
filtered.observed.judgments = [{ key: a.key, relevance: 3 }, { key: b.key, relevance: 0 }, { key: c.key, relevance: 0 }, { key: d.key, relevance: 1 }];
seal(filtered);
const eligibility = await evaluateVectorOracles(filtered, { k: 3 });
assert.equal(eligibility.eligibility.missingCount, 1); assert.equal(eligibility.eligibility.extraCount, 1);
assert.equal(eligibility.counts.vectorIneligibleCandidates, 2);
assert.equal(eligibility.metrics.annCandidateRecall.value, 0);
assert.equal(eligibility.metrics.sparseVectorUnionInclusion.value, 0.5);
assert.equal(eligibility.metrics.humanRelevance.recallAtK, 0.5);
assert.equal(eligibility.metrics.humanRelevance.mrr, 1 / 3);
assert.equal(eligibility.metrics.humanRelevance.ndcgAtK, (7 / Math.log2(4)) / (7 + 1 / Math.log2(3)));
const empty = make(); empty.eligibility.admittedKeys = []; empty.observed.eligibleKeys = []; seal(empty);
const noRows = await evaluateVectorOracles(empty);
assert.deepEqual(noRows.stored.results, []); assert.equal(noRows.metrics.annCandidateRecall.value, null);
assert.equal(noRows.metrics.annCandidateRecall.denominator, 0);
const singleton = make(); singleton.eligibility.admittedKeys = [singleton.rows[3].key]; seal(singleton);
assert.equal((await evaluateVectorOracles(singleton, { k: 10 })).original.results.length, 1);

const quantized = make(); quantized.rows = quantized.rows.slice(0, 2);
quantized.rows[0].stored = [1, 2]; quantized.rows[1].stored = [2, 1];
quantized.eligibility.admittedKeys = quantized.rows.map(item => item.key); quantized.observed.eligibleKeys = [...quantized.eligibility.admittedKeys];
quantized.observed.vectorKeys = [quantized.rows[0].key]; quantized.observed.sparseKeys = [quantized.rows[1].key]; seal(quantized);
const changedOrder = await evaluateVectorOracles(quantized, { k: 1 });
assert.equal(changedOrder.original.results[0].key, quantized.rows[0].key);
assert.equal(changedOrder.stored.results[0].key, quantized.rows[1].key);
assert.equal(changedOrder.metrics.quantizationAgreement.value, 0, 'quantization loss is independent of ANN omission');
assert.equal(changedOrder.metrics.annCandidateRecall.value, 0);
assert.equal(changedOrder.metrics.sparseVectorUnionInclusion.value, 1);
const unavailable = make(); unavailable.rows.forEach(item => { item.original = null; });
unavailable.originals = { status: 'unavailable', capture: 'unavailable', digest: null }; seal(unavailable);
const storedOnly = await evaluateVectorOracles(unavailable);
assert.equal(storedOnly.original.status, 'unavailable'); assert.deepEqual(storedOnly.original.results, []);
assert.equal(storedOnly.stored.status, 'complete'); assert.equal(storedOnly.metrics.quantizationAgreement, null);
assert.equal(storedOnly.metrics.sparseVectorUnionInclusion.reference, 'stored-representation');
const partial = make(); partial.rows[0].original = null; partial.originals.status = 'partial'; seal(partial);
const partlyCaptured = await evaluateVectorOracles(partial);
assert.equal(partlyCaptured.original.status, 'incomplete'); assert.equal(partlyCaptured.stored.status, 'complete');
assert.equal(partlyCaptured.metrics.quantizationAgreement, null);

const stable = make(), reordered = structuredClone(stable); reordered.rows.reverse(); reordered.eligibility.admittedKeys.reverse();
reordered.observed.eligibleKeys.reverse();
assert.equal(admitVectorEvaluationRecord(stable).key, admitVectorEvaluationRecord(reordered).key, 'source order cannot become an ordinal join or resume identity');
const baseline = await evaluateVectorOracles(stable, { k: 2 });
assert.deepEqual((await evaluateVectorOracles(reordered, { k: 2, resumeKey: baseline.recordKey })).original.results, baseline.original.results);
const aborted = new AbortController(); setImmediate(() => aborted.abort());
const interrupted = await evaluateVectorOracles(stable, { signal: aborted.signal, limits: { batchRows: 1 } });
assert.equal(interrupted.complete, false); assert.equal(interrupted.reason, 'cancelled'); assert.equal(interrupted.metrics, null);
assert.equal(interrupted.replay.cacheableComplete, false);
for (const limits of [{ work: 1 }, { rows: 1 }, { coordinates: 1 }, { outputBytes: 256 }]) {
  const limited = await evaluateVectorOracles(stable, { limits });
  assert.equal(limited.complete, false); assert.equal(limited.metrics, null);
  if (limits.outputBytes) assert(Buffer.byteLength(JSON.stringify(limited)) <= limits.outputBytes);
}
for (const edit of [
  value => { value.rows[0].original[0] = NaN; }, value => { value.rows[0].original[0] = 0.1; },
  value => { value.rows[0].stored[0] = 255; }, value => { value.rows[0].source.file = '../outside.js'; },
  value => { value.rows[0].key = '0'.repeat(64); }, value => { value.rows.push(structuredClone(value.rows[0])); },
  value => { value.embedding.modelId = 'changed-model'; }, value => { value.corpus.generation = hash('generation-two'); },
  value => { value.embedding.revision = 'main'; },
  value => { value.query.filterDigest = hash('changed-filter'); }, value => { value.originals.digest = hash('corrupt-capture'); }
]) {
  const corrupt = structuredClone(stable); edit(corrupt);
  await assert.rejects(evaluateVectorOracles(corrupt), { code: 'ERR_VECTOR_EVALUATION_RECORD' });
}
const changed = make(); changed.corpus.generation = hash('new-generation'); seal(changed);
await assert.rejects(evaluateVectorOracles(changed, { resumeKey: baseline.recordKey }), { code: 'ERR_VECTOR_EVALUATION_RECORD' });
const otherModel = make(); otherModel.embedding.modelId = 'other-model'; otherModel.corpus.generation = hash('other-model-generation'); seal(otherModel);
assert.equal(otherModel.corpus.sourceDigest, stable.corpus.sourceDigest);
assert.deepEqual((await evaluateVectorOracles(otherModel, { k: 2 })).original.results.map(item => item.key), baseline.original.results.map(item => item.key));
await assert.rejects(evaluateVectorOracles(otherModel, { resumeKey: baseline.recordKey }), { code: 'ERR_VECTOR_EVALUATION_RECORD' });
const replay = await evaluateDatasetVectorReplay({ entry: { vectorEvaluation: stable }, query: queryText, topN: 2 });
assert.equal(replay.kind, 'saved-stage-replay'); assert.equal(replay.currentSearchEvidence, false);
assert.equal(replay.receipts[0].recordKey, baseline.recordKey);
assert.equal(Object.hasOwn(replay, 'pairedQuality'), false, 'default replay output keeps the existing shape');
const compared = await evaluateDatasetVectorReplay({ entry: { vectorEvaluation: [stable, otherModel],
  vectorQualityComparison: { baseline: 0, candidate: 1, metric: 'annCandidateRecall' } }, query: queryText, topN: 2 });
assert.equal(compared.pairedQuality.complete, true); assert.equal(compared.pairedQuality.estimates.completePairs, 1);
assert.equal(compared.pairedQuality.estimates.repositoryMacro.meanDifference, 0);
assert.equal(compared.pairedQuality.estimates.repositoryMacro.interval95, null);
assert.notEqual(compared.pairedQuality.baselineKey, compared.pairedQuality.candidateKey, 'model/generation identity remains part of each comparison side');
await assert.rejects(compareVectorOracleQuality({ baseline: [baseline], candidate: [await evaluateVectorOracles(stable, { k: 1 })] }), /policies differ/);
await assert.rejects(compareVectorOracleQuality({ baseline: [baseline], candidate: [baseline], metric: 'humanRecall' }), /supported metric/);
await assert.rejects(compareVectorOracleQuality({ baseline: [baseline], candidate: [{ ...baseline, provenance: null }] }), /identity/);
await assert.rejects(compareVectorOracleQuality({ baseline: [baseline], candidate: [baseline], cluster: 'family' }), /family assignment/);
await assert.rejects(evaluateDatasetVectorReplay({ entry: { vectorEvaluation: stable }, query: 'different text', topN: 2 }));
console.log('independent original/stored vector geometry, provenance, eligibility and incomplete replay assertions complete');
