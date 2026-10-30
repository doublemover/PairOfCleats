import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readVerifiedContainedFile } from '../../../src/shared/contained-file.js';
import { compareDenseReferenceVectors, measureDenseReferenceVectors } from './dense-upstream-reference.js';
import { denseInputIdentity } from './dense-judged-corpus.js';

export const E5_BOUNDARY_SOURCE = Object.freeze({ path: 'tests/fixtures/embeddings/multilingual-dense/e5-truncation-boundary.json',
  sha256: '21737c62ca252040cae0c05725ca6f92efa9fa69235732085d8d9e24fe44b318' });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const integers = values => {
  const bytes = Buffer.alloc(values.length * 8);
  values.forEach((value, index) => bytes.writeBigInt64LE(BigInt(value), index * 8)); return sha(bytes);
};
export const buildE5BoundaryCases = (fixture, kind) => {
  assert.ok(['documents', 'queries'].includes(kind)); assert.equal(fixture.maximumLength, 512);
  assert.equal(fixture.queryPrefix, 'Instruct: Given a code search query, retrieve relevant source code or documentation passages that answer the query\nQuery: ');
  assert.equal(fixture.bos, 0); assert.equal(fixture.eos, 2); assert.equal(fixture.pad, 1);
  assert.equal(fixture.repeat.tokenId, 10); assert.equal(fixture.tail.tokenId, 876);
  const prefix = kind === 'queries' ? fixture.queryPrefixTokenIds : [];
  const capacity = 510 - prefix.length;
  assert.equal(capacity, kind === 'queries' ? fixture.queryPayloadCapacity : fixture.passagePayloadCapacity);
  return fixture.cases.map(row => {
    const count = capacity + row.capacityOffset;
    const raw = Array(count).fill('a').concat(row.tail ? ['b'] : []).join(' ');
    const text = kind === 'queries' ? fixture.queryPrefix + raw : raw;
    const full = [0, ...prefix, ...Array(count).fill(10), ...(row.tail ? [876] : []), 2];
    assert.equal(full.length, row.tokensBeforeTruncation);
    const ids = full.length > 512 ? [...full.slice(0, 511), 2] : full;
    assert.equal(ids.length, row.expectedTokens);
    return { id: row.id, raw, text, input: denseInputIdentity(text), ids, tokensBeforeTruncation: full.length };
  });
};
const assertTokens = (raw, cases, batch) => {
  const sequence = batch ? 512 : cases[0].ids.length;
  const ids = cases.flatMap(row => row.ids.concat(Array(sequence - row.ids.length).fill(1)));
  const mask = cases.flatMap(row => Array(row.ids.length).fill(1).concat(Array(sequence - row.ids.length).fill(0)));
  assert.deepEqual(raw.tokenization.inputIds.dimensions, [cases.length, sequence]);
  assert.equal(raw.tokenization.inputIds.dtype, 'int64'); assert.equal(raw.tokenization.inputIds.sha256, integers(ids));
  assert.deepEqual(raw.tokenization.attentionMask.dimensions, [cases.length, sequence]);
  assert.equal(raw.tokenization.attentionMask.dtype, 'int64'); assert.equal(raw.tokenization.attentionMask.sha256, integers(mask));
  assert.deepEqual(raw.tokenization.tokenCounts, cases.map(row => row.ids.length));
};

export const runE5TruncationCohort = async ({ options, phase, receipt, numericalReference, rawReference, adapter,
  getQueryEmbedding, formatEmbeddingInput, root, manifest, modelArtifact, signal }) => {
  assert.equal(manifest.modelId, 'intfloat/multilingual-e5-large-instruct');
  const documents = options.cohort === 'truncation-documents', reference = options.route === 'upstream-reference';
  const saved = await readVerifiedContainedFile(process.cwd(), path.resolve(E5_BOUNDARY_SOURCE.path), {
    expectedHash: E5_BOUNDARY_SOURCE.sha256, hashAlgorithm: 'sha256', maxBytes: 65536, signal });
  const fixture = JSON.parse(saved.buffer.toString('utf8')), cases = buildE5BoundaryCases(fixture, documents ? 'documents' : 'queries');
  assert.equal(manifest.artifacts.find(row => row.path === 'tokenizer.json')?.sha256, fixture.tokenizerSha256);
  const rows = [], runs = [];
  if (!reference) {
    assert.deepEqual(numericalReference.truncation.source, E5_BOUNDARY_SOURCE);
    assert.deepEqual(numericalReference.truncation.rows.map(row => ({ id: row.id, input: row.input })), cases.map(row => ({ id: row.id, input: row.input })));
    for (const row of cases) assert.equal(formatEmbeddingInput(row.raw, { modelId: manifest.modelId, kind: documents ? 'passage' : 'query' }), row.text);
  }
  const batches = documents ? [cases] : cases.map(row => [row]);
  for (const batch of batches) {
    const started = performance.now(), cpu = process.cpuUsage(); let vectors, raw = null;
    if (reference) {
      raw = await phase('raw-author-512-' + batch[0].id, () => rawReference.embed(batch.map(row => row.text)));
      assertTokens(raw, batch, documents); vectors = raw.vectors;
    } else if (documents) vectors = await phase('public-index-512', () => adapter.getChunkEmbeddings(batch.map(row => row.raw)));
    else vectors = [await phase('public-query-512-' + batch[0].id, () => getQueryEmbedding({ text: batch[0].raw,
      modelId: manifest.modelId, dims: 1024, modelDir: manifest.modelsDir, rootDir: root, provider: 'xenova', normalize: true,
      useStub: false, modelArtifact }))];
    const elapsedMs = performance.now() - started, runCpu = process.cpuUsage(cpu);
    compareDenseReferenceVectors(vectors, vectors, 1e-5);
    if (!reference) compareDenseReferenceVectors(vectors, batch.map(row => numericalReference.truncation.rows.find(expected => expected.id === row.id).vector), 1e-5);
    rows.push(...vectors.map((vector, index) => ({ id: batch[index].id, input: batch[index].input,
      tokensBeforeTruncation: batch[index].tokensBeforeTruncation, expectedTokens: batch[index].ids.length, vector: [...vector] })));
    runs.push({ caseIds: batch.map(row => row.id), elapsedMs, cpu: runCpu, outputBytes: vectors.length * 1024 * 4,
      tokenization: raw?.tokenization || null, rawOutput: raw?.rawOutput || null });
  }
  compareDenseReferenceVectors([rows[1].vector], [rows[2].vector], 1e-5);
  const admittedTail = measureDenseReferenceVectors([rows[1].vector], [rows[3].vector], 1e-5);
  assert(admittedTail.maxAbsoluteError > 1e-5, 'The admitted tail must discriminate this real model from the discarded-tail control.');
  receipt.cohort = options.cohort; receipt.vectors = rows.map(row => row.vector);
  receipt.truncation = { source: E5_BOUNDARY_SOURCE, tokenizerSha256: fixture.tokenizerSha256, rows, runs, admittedTail,
    policy: 'Independent BOS/payload/EOS expectations at511/512/513untruncated tokens;preserveEOS,truncatepayload,padonlythebatch.',
    executionPolicy: 'Raw reference requests one thread;public consumers keep original defaults;no matched-thread speed claim.' };
  receipt.execution = reference ? { provider: 'upstream-raw-AutoTokenizer-AutoModel', stub: false, dtype: 'fp32' } : adapter.executionInfo();
  if (!reference) { assert.equal(receipt.execution.stub, false); assert.equal(receipt.execution.provider, 'xenova'); }
};
