import assert from 'node:assert/strict';
import { denseReferenceQuery, compareDenseReferenceVectors } from './dense-upstream-reference.js';
import { denseInputIdentity } from './dense-judged-corpus.js';

/** Each document/query arm owns one real model lifetime under its original
 * capsule deadline. Never partition away documents after a timeout.
 */
export const runDenseJudgedCohort = async ({ corpus, recipe, options, phase, receipt, numericalReference,
  rawReference, adapter, getQueryEmbedding, formatEmbeddingInput, root, manifest, modelArtifact, signal }) => {
  assert.ok(['judged-documents', 'judged-queries'].includes(options.cohort));
  const reference = options.route === 'upstream-reference';
  assert.equal(Boolean(rawReference), reference);
  if (!reference) {
    assert.equal(options.route, options.cohort === 'judged-documents' ? 'batch' : 'query');
    assert.equal(numericalReference?.cohort, options.cohort);
  }
  const documents = options.cohort === 'judged-documents';
  const selected = documents ? corpus.documents : corpus.queries;
  const texts = selected.map(row => documents ? row.text : denseReferenceQuery(recipe, row.text));
  if (!reference) {
    assert.equal(numericalReference.judged.implementation, 'raw-author-reference');
    assert.equal(numericalReference.judged.corpusId, corpus.id); assert.equal(numericalReference.judged.corpusVersion, corpus.version);
    assert.deepEqual(numericalReference.judged.rows.map(row => ({ id: row.id, language: row.language, input: row.input })),
      selected.map((row, index) => ({ id: row.id, language: row.language, input: denseInputIdentity(texts[index]) })),
      'Reference order, original source IDs and exact query/passage bytes must agree before inference.');
  }
  const report = { schemaVersion: 1, corpusId: corpus.id, corpusVersion: corpus.version,
    implementation: reference ? 'raw-author-reference' : 'actual-product-consumer', cohort: options.cohort,
    inputPolicy: documents ? 'exact saved passage bytes' : 'independent exact author query template',
    executionPolicy: reference ? 'Raw upstream session requests one intra/inter thread.'
      : 'Public index/query consumers retain original session defaults;no matched-thread cost claim.',
    rows: [], passes: [], tokenEstimation: null, preprocessing: null };
  if (!reference) {
    const began = performance.now(), cpu = process.cpuUsage();
    const actual = selected.map(row => formatEmbeddingInput(row.text, { modelId: manifest.modelId, kind: documents ? 'passage' : 'query' }));
    assert.deepEqual(actual, texts, 'Actual product formatting must match independently authored passage/query bytes.');
    report.preprocessing = { elapsedMs: performance.now() - began, cpu: process.cpuUsage(cpu), inputs: actual.map(denseInputIdentity),
      scope: 'separate formatting verification;public consumer inference below also includes its own formatting' };
  }
  const invoke = async (indices, temperature) => {
    const started = performance.now(), cpu = process.cpuUsage(), allocationStart = receipt.allocations.length;
    let vectors, raw = null;
    if (reference) {
      raw = await phase('judged-raw-' + temperature, () => rawReference.embed(indices.map(index => texts[index])));
      vectors = raw.vectors;
    } else if (documents) vectors = await phase('judged-public-index-' + temperature, () => adapter.getChunkEmbeddings(indices.map(index => texts[index])));
    else vectors = [await phase('judged-public-query-' + temperature, () => getQueryEmbedding({
      text: selected[indices[0]].text, modelId: manifest.modelId, dims: manifest.dimensions,
      modelDir: manifest.modelsDir, provider: manifest.provider, rootDir: root, useStub: false,
      normalize: true, modelArtifact }))];
    const elapsedMs = performance.now() - started, executionCpu = process.cpuUsage(cpu);
    assert.equal(vectors.length, indices.length); assert(vectors.every(Boolean));
    const comparisons = reference ? null : compareDenseReferenceVectors(vectors,
      indices.map(index => numericalReference.judged.rows[index].vector), manifest.tolerance);
    // Strict finite/cardinality/width/norm checks also apply to reference-only
    // observations, independently of the product output-admission helper.
    compareDenseReferenceVectors(vectors, vectors, manifest.tolerance);
    const rows = vectors.map((vector, offset) => ({ id: selected[indices[offset]].id,
      language: selected[indices[offset]].language, input: denseInputIdentity(texts[indices[offset]]), vector: [...vector] }));
    const copies = receipt.allocations.slice(allocationStart);
    if (!reference) assert(copies.reduce((bytes, copy) => bytes + copy.bytes, 0) <= indices.length * 1024 * 4,
      'Product admission may allocate only its necessary owned output copy.');
    report.passes.push({ temperature, rows: indices.length, elapsedMs, cpu: executionCpu,
      rowsPerSecond: indices.length * 1000 / elapsedMs, outputBytes: indices.length * 1024 * 4,
      tokenization: raw?.tokenization || null, rawOutput: raw?.rawOutput || null,
      copies, comparisons });
    return rows;
  };
  if (documents) {
    const indices = selected.map((row, index) => index);
    report.rows = await invoke(indices, 'cold-first-inference');
    const repeated = await invoke(indices, 'warm-same-batch');
    compareDenseReferenceVectors(repeated.map(row => row.vector), report.rows.map(row => row.vector), manifest.tolerance);
  } else {
    for (let index = 0; index < selected.length; index++) report.rows.push(...await invoke([index], index ? 'warm-distinct-query-' + index : 'cold-first-query'));
    const repeated = await invoke([0], 'warm-repeated-first-query');
    compareDenseReferenceVectors([repeated[0].vector], [report.rows[0].vector], manifest.tolerance);
  }
  if (!reference) {
    const began = performance.now(), cpu = process.cpuUsage();
    const values = await phase('actual-token-estimation', () => documents
      ? adapter.getChunkEmbeddings.estimateTokensBatch(texts) : adapter.estimateTokensBatch(texts));
    assert.equal(values.length, texts.length); assert(values.every(value => Number.isFinite(value) && value >= 0));
    report.tokenEstimation = { elapsedMs: performance.now() - began, cpu: process.cpuUsage(cpu), values,
      scope: 'original product token-estimation owner;not a query-result-cache or tokenizer-equivalence claim' };
    assert.equal(adapter.executionInfo().stub, false);
    assert.equal(adapter.executionInfo().provider, manifest.provider, 'Actual consumer cannot silently change providers.');
  }
  receipt.cohort = options.cohort; receipt.judged = report; receipt.vectors = report.rows.map(row => row.vector);
  receipt.acceptance.judgedRetrieval = 'paired document/query cohort receipts required;no per-arm quality claim';
  receipt.execution = reference ? { provider: 'upstream-raw-AutoTokenizer-AutoModel', stub: false,
    dtype: recipe.dtype, device: 'cpu', requestedSessionOptions: { intraOpNumThreads: 1, interOpNumThreads: 1 } } : adapter.executionInfo();
};
