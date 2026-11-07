import assert from 'node:assert/strict';
import { createSemanticSourceSnapshot } from '../../../src/index/semantic/source.js';
import { createNaturalSparseTokenView, openNaturalSparseTokenView, rankNaturalSparseTokenView }
  from '../../../src/retrieval/views/natural-sparse-tokens.js';

const profile = { generation: { baseBuildId: 'build', semanticRevision: 0 }, repositoryNamespace: 'repo', contextKey: 'model-context',
  modelId: 'fixture-natural', tokenizerId: 'hand-authored-v1', lexicalSpaceId: 'x-y', queryRole: 'query', documentRole: 'document',
  aggregation: 'maxsim-all-window-tokens-v1', numeric: 'exact-natural-v1' };
const snapshot = (id, text = 'abcd') => createSemanticSourceSnapshot({ bytes: Buffer.from(text), repositoryNamespace: 'repo', path: id + '.txt', language: 'text' });
const token = (id, weights, span = [0, 2]) => ({ id, span, weights });
const doc = (id, tokens, status = 'encoded') => ({ id, snapshot: snapshot(id), windows: [{ id: id + '-window', span: [0, 4], status, tokens }] });
const queryView = createNaturalSparseTokenView({ profile, role: 'query', documents: [doc('query', [token('q', [['x', '1'], ['y', '1']])])] });
const documents = [doc('separate', [token('x-only', [['x', '3']]), token('y-only', [['y', '5']], [2, 4])]),
  doc('together', [token('both', [['x', '3'], ['y', '5']])]), doc('zero', [token('zero', [])])];
const view = createNaturalSparseTokenView({ profile, role: 'document', documents });
let released = 0;
const reader = openNaturalSparseTokenView({ view, queryView, release: () => released++ });
assert.deepEqual(reader.enumerate().find(row => row.id === 'separate').interval, { lower: '5', upper: '8' });
const first = reader.refine('separate', { maxWork: 1 });
assert.deepEqual(first.interval, { lower: '5', upper: '8' });
const final = reader.refine('separate', { maxWork: 1 });
assert.deepEqual(final.interval, { lower: '5', upper: '5' });
assert.equal(reader.expand('separate', 'y-only').text, 'cd', 'later source window remains mapped');
reader.close(); reader.close(); assert.equal(released, 1);
assert.deepEqual(rankNaturalSparseTokenView({ view, queryView }).hits,
  [{ id: 'together', score: '8' }, { id: 'separate', score: '5' }, { id: 'zero', score: '0' }]);
const missing = createNaturalSparseTokenView({ profile, role: 'document', documents: [doc('missing', [], 'missing')] });
assert.equal(rankNaturalSparseTokenView({ view: missing, queryView }).status, 'unavailable');
const emptyQuery = createNaturalSparseTokenView({ profile, role: 'query', documents: [doc('empty', [])] });
assert.deepEqual(rankNaturalSparseTokenView({ view, queryView: emptyQuery }).hits.map(row => row.score), ['0', '0', '0']);
assert.throws(() => createNaturalSparseTokenView({ profile, role: 'document', documents: [doc('negative', [token('bad', [['x', '-1']])])] }), /coordinates/);
assert.throws(() => createNaturalSparseTokenView({ profile, role: 'document', documents: [doc('float', [token('bad', [['x', '0.5']])])] }), /coordinates/);
assert.throws(() => openNaturalSparseTokenView({ view, queryView: view }), /query representation/);
const staleQuery = createNaturalSparseTokenView({ profile: { ...profile, lexicalSpaceId: 'changed' }, role: 'query', documents: [doc('query', [])] });
assert.throws(() => openNaturalSparseTokenView({ view, queryView: staleQuery }), /compatible/);
const forged = doc('forged', []); forged.snapshot.manifest.sourceUnitId = 'su1:' + '0'.repeat(64);
assert.throws(() => createNaturalSparseTokenView({ profile, role: 'document', documents: [forged] }), /manifest/);
const tail = doc('tail', []); tail.windows[0].span = [0, 2];
assert.equal(createNaturalSparseTokenView({ profile, role: 'document', documents: [tail] }).encodedCoverageComplete, false);
const controller = new AbortController(); controller.abort();
assert.equal(rankNaturalSparseTokenView({ view, queryView, signal: controller.signal }).status, 'cancelled');

// Independent dense integer oracle over all tiny two-coordinate token tensors.
for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) for (let c = 0; c < 3; c++) for (let d = 0; d < 3; d++) {
  const sparse = values => values.flatMap((value, index) => value ? [[['x', 'y'][index], String(value)]] : []);
  const candidate = createNaturalSparseTokenView({ profile, role: 'document', documents: [doc('candidate', [
    token('first', sparse([a, b])), token('second', sparse([c, d]))])] });
  const oracle = BigInt(Math.max(a + b, c + d)), session = openNaturalSparseTokenView({ view: candidate, queryView });
  let step = session.enumerate()[0];
  while (true) {
    assert(BigInt(step.interval.lower) <= oracle && oracle <= BigInt(step.interval.upper));
    if (step.scoreStatus === 'exact-natural') break;
    step = session.refine('candidate', { maxWork: 1 });
  }
  assert.equal(step.interval.lower, oracle.toString()); session.close();
}
console.log('exact-natural sparse token view contract passed');
