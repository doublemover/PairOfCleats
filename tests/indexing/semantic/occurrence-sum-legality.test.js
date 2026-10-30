import assert from 'node:assert/strict';
import { createOccurrenceRelation, openOccurrenceCursor } from '../../../src/semantic/relations/factor.js';
import { OCCURRENCE_SUM_OBSERVATION, createOccurrenceSumRequest, proposeOccurrenceSumNormalization,
  checkOccurrenceSumProof, admitOccurrenceSumAlternative, executeOccurrenceSumRequest }
  from '../../../src/index/semantic/equivalence/occurrence-sums.js';

const world = { generation: { baseBuildId: 'build', semanticRevision: 0 } };
const relation = (id, value, count = '1') => createOccurrenceRelation({ world, relationId: id, atomRoleId: 'source-row',
  schema: [{ name: 'value', type: 'string', nullable: true }], rows: [{ occurrenceId: id, supportId: 'support:' + id,
    tuple: [value], multiplicity: count, sourceRef: id }], complete: true });
const inputs = new Map([['a', relation('a', 'same', '2')], ['b', relation('b', null)], ['c', relation('c', 'same')]]);
const input = name => ({ op: 'input', input: name });
const sum = (...children) => ({ op: 'sum', children });
const proposal = proposeOccurrenceSumNormalization({ inputs, term: sum(input('c'), sum(input('a'), input('b')), input('a')),
  world, observation: OCCURRENCE_SUM_OBSERVATION });
const checked = checkOccurrenceSumProof(proposal);
assert.equal(checked.status, 'checked-in-model');
assert.equal(admitOccurrenceSumAlternative({ request: proposal.request, receipt: checked.receipt }).admitted, true);
assert.equal(admitOccurrenceSumAlternative({ request: proposal.request, receipt: { ...checked.receipt } }).admitted, false);
const original = executeOccurrenceSumRequest({ request: proposal.request });
const alternative = executeOccurrenceSumRequest({ request: proposal.request, receipt: checked.receipt });
const observe = relation => {
  const cursor = openOccurrenceCursor({ relation });
  try { return cursor.next({ limit: 256 }).items.map(row => JSON.stringify({ tuple: row.tuple, occurrences: row.occurrences })).sort(); }
  finally { cursor.close(); }
};
assert.deepEqual(observe(original.relation), observe(alternative.relation));
assert.equal(original.relation.cardinality, '6', 'duplicate original occurrences remain multiplicative');
assert.equal(alternative.physicalChoicePaths, 'not-equated');
const idempotence = createOccurrenceSumRequest({ inputs, world, observation: OCCURRENCE_SUM_OBSERVATION,
  left: sum(input('a'), input('a')), right: input('a') });
const idempotenceProof = { ...proposal.proof, requestId: idempotence.requestId, leftHash: idempotence.leftHash, rightHash: idempotence.rightHash };
assert.equal(checkOccurrenceSumProof({ request: idempotence, proof: idempotenceProof }).reason, 'operand-multiplicity-mismatch');
assert.equal(checkOccurrenceSumProof({ ...proposal, proof: { ...proposal.proof, rule: 'union-idempotence' } }).status, 'rejected');
assert.equal(checkOccurrenceSumProof({ ...proposal, proof: { ...proposal.proof, leftHash: 'forged' } }).status, 'rejected');
assert.equal(checkOccurrenceSumProof({ ...proposal, maxWork: 0 }).status, 'unknown');
const controller = new AbortController(); controller.abort();
assert.equal(checkOccurrenceSumProof({ ...proposal, signal: controller.signal }).status, 'unknown');
assert.throws(() => executeOccurrenceSumRequest({ request: idempotence, receipt: checked.receipt }), /unadmitted/);
assert.throws(() => createOccurrenceSumRequest({ inputs, left: input('a'), right: input('a'), world, observation: 'ranked-order' }), /unsupported observation/);
assert.throws(() => createOccurrenceSumRequest({ inputs, left: input('a'), right: input('a'), world: { changed: true },
  observation: OCCURRENCE_SUM_OBSERVATION }), /world/);
assert.throws(() => createOccurrenceSumRequest({ inputs, left: { op: 'effectful-call' }, right: input('a'), world,
  observation: OCCURRENCE_SUM_OBSERVATION }), /unsupported term/);

// Independent occurrence-count oracle for every small three-input multiplicity combination.
for (let a = 0; a <= 2; a++) for (let b = 0; b <= 2; b++) for (let c = 0; c <= 2; c++) {
  const names = [...Array(a).fill('a'), ...Array(b).fill('b'), ...Array(c).fill('c')];
  if (!names.length) continue;
  const candidate = proposeOccurrenceSumNormalization({ inputs, term: sum(...names.reverse().map(input)), world,
    observation: OCCURRENCE_SUM_OBSERVATION });
  const verified = checkOccurrenceSumProof(candidate);
  assert.equal(verified.status, 'checked-in-model');
  const executed = executeOccurrenceSumRequest({ request: candidate.request, receipt: verified.receipt });
  assert.equal(executed.relation.cardinality, String(2 * a + b + c));
  assert.deepEqual(observe(executeOccurrenceSumRequest({ request: candidate.request }).relation), observe(executed.relation));
}
console.log('ground occurrence-bag sum legality contract passed');
