import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readVerifiedContainedFile } from '../../../src/shared/contained-file.js';
import { qualifyRetrieval } from '../../../tools/history/eg2-qualify-quality.js';

export const DENSE_JUDGED_CORPUS = Object.freeze({
  path: 'tests/fixtures/embeddings/multilingual-dense/corpus.json',
  sha256: '0932a7f4fb1d26f59846f63ff571dcc95384ea9f1f113430f8dc07e3be6d2140'
});
const hash = text => createHash('sha256').update(text).digest('hex');
export const denseInputIdentity = text => ({ bytes: Buffer.byteLength(text), sha256: hash(text) });

/** Read actual saved code/doc bytes. Every query/document pair has a declared
 * grade; omitted judgments never quietly become negatives in this corpus.
 */
export const loadDenseJudgedCorpus = async ({ root = process.cwd(), manifest = null, signal = null } = {}) => {
  if (manifest) assert.deepEqual(manifest.corpusSource, DENSE_JUDGED_CORPUS);
  const filename = path.join(root, ...DENSE_JUDGED_CORPUS.path.split('/'));
  const read = await readVerifiedContainedFile(root, filename, { expectedHash: DENSE_JUDGED_CORPUS.sha256,
    hashAlgorithm: 'sha256', maxBytes: 65536, signal });
  const corpus = JSON.parse(read.buffer.toString('utf8'));
  assert.equal(corpus.schemaVersion, 1); assert.equal(corpus.version, 1);
  assert.equal(corpus.id, 'multilingual-code-doc-closed-world-v1');
  assert.equal(corpus.documents.length, 16); assert.equal(corpus.queries.length, 8);
  assert.equal(new Set(corpus.documents.map(row => row.id)).size, 16);
  assert.equal(new Set(corpus.queries.map(row => row.id)).size, 8);
  const documents = [];
  for (const row of corpus.documents) {
    assert.match(row.path, /^[a-z-]+\.(?:js\.txt|md)$/);
    const saved = await readVerifiedContainedFile(path.dirname(filename), path.join(path.dirname(filename), row.path), {
      expectedHash: row.sha256, expectedBytes: row.bytes, hashAlgorithm: 'sha256', maxBytes: 4096, signal });
    const text = new TextDecoder('utf-8', { fatal: true }).decode(saved.buffer);
    assert.ok(!text.includes('\r')); assert.equal(Buffer.byteLength(text), row.bytes);
    documents.push({ ...row, text });
  }
  const ids = documents.map(row => row.id);
  assert.deepEqual(Object.keys(corpus.judgments), corpus.queries.map(row => row.id));
  for (const query of corpus.queries) {
    assert.ok(['en', 'zh'].includes(query.language)); assert.equal(hash(query.text), query.sha256);
    assert.deepEqual(Object.keys(corpus.judgments[query.id]), ids);
    const grades = Object.values(corpus.judgments[query.id]);
    assert(grades.every(grade => Number.isInteger(grade) && grade >= 0 && grade <= 3));
    assert.equal(grades.filter(grade => grade > 0).length, 2);
    assert.equal(query.hardNegatives.length, 2);
    for (const id of query.hardNegatives) assert.equal(corpus.judgments[query.id][id], 0);
  }
  assert.equal(corpus.queries.filter(row => row.language === 'en').length, 4);
  assert.equal(corpus.queries.filter(row => row.language === 'zh').length, 4);
  if (manifest) {
    assert.equal(manifest.corpusProvenance, corpus.provenance);
    assert.deepEqual(manifest.texts, documents.map(row => row.text));
  }
  return { ...corpus, documents, source: DENSE_JUDGED_CORPUS };
};

/** Reuse established paired cosine/ranking math while explicitly replacing its
 * EG2 report label. No relevance threshold or automatic promotion is invented.
 */
export const summarizeDenseJudgments = ({ corpus, referenceDocuments, candidateDocuments, referenceQueries, candidateQueries }) => {
  for (const [rows, expected] of [[referenceDocuments, corpus.documents], [candidateDocuments, corpus.documents],
    [referenceQueries, corpus.queries], [candidateQueries, corpus.queries]]) {
    assert.deepEqual(rows.map(row => row.id).sort(), expected.map(row => row.id).sort(), 'Exact frozen corpus coverage is required.');
  }
  const asRows = values => values.map(row => ({ id: row.id, vector: row.vector }));
  const reports = [];
  for (const language of ['all', 'en', 'zh']) {
    const ids = new Set(corpus.queries.filter(row => language === 'all' || row.language === language).map(row => row.id));
    for (const k of [1, 3, 5]) {
      const report = qualifyRetrieval({ k, judgments: corpus.judgments,
        reference: { documents: asRows(referenceDocuments), queries: asRows(referenceQueries.filter(row => ids.has(row.id))) },
        candidate: { documents: asRows(candidateDocuments), queries: asRows(candidateQueries.filter(row => ids.has(row.id))) } });
      assert.equal(report.judgedQueries, ids.size);
      reports.push({ ...report, schema: 'dense.closed-world-retrieval-qualification.v1', language,
        acceptance: 'Descriptive frozen closed-world judgments only; no representative gain or automatic promotion.' });
    }
  }
  return { corpus: corpus.source, corpusId: corpus.id, corpusVersion: corpus.version, scope: corpus.scope,
    judgments: 'complete predeclared grades for all128query/document pairs;two hard negatives perquery', reports };
};
