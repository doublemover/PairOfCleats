import assert from 'node:assert/strict';
import { captureEvaluationDatasetCases } from '../../../tools/eval/dataset-admission.js';

// Actual dataset/label owner only; UNVALIDATED, no query or process execution.
const invalid = error => ['ERR_EVAL_DATASET', 'ERR_EVAL_JUDGMENT'].includes(error.code);
for (const key of ['relevant', 'expect', 'gold']) {
  for (const value of [null, undefined, false, 0, '', {}, 'labels', new Array(1), [null], [{}]]) {
    assert.throws(() => captureEvaluationDatasetCases([{ query: 'known query', [key]: value }]), invalid);
  }
  const accessorRows = [];
  Object.defineProperty(accessorRows, 0, { get() { assert.fail('array slots cannot run label callbacks'); } });
  assert.throws(() => captureEvaluationDatasetCases([{ query: 'known query', [key]: accessorRows }]), invalid);
  const entry = { query: 'known query' };
  Object.defineProperty(entry, key, { get() { assert.fail('a label container cannot be an accessor'); } });
  assert.throws(() => captureEvaluationDatasetCases([entry]), invalid);
  assert.throws(() => captureEvaluationDatasetCases([Object.assign(Object.create({ [key]: [] }), { query: 'known query' })]), invalid);
}
for (const input of [null, {}, new Array(1), [null], [[]], [{}], [{ query: '' }], [{ query: false }], [{ query: 17 }]]) {
  assert.throws(() => captureEvaluationDatasetCases(input), invalid);
}
assert.throws(() => captureEvaluationDatasetCases([{ query: 'known query', relevant: [], expect: null }]), invalid,
  'an explicit malformed alias cannot hide behind a valid canonical container');
const relevant = [{ file: 'original.js' }], gold = [{ name: 'original' }];
const entry = { query: ' original query ', relevant, gold, mode: 'code' };
const [accepted] = captureEvaluationDatasetCases([entry]);
assert.equal(accepted.entry, entry); assert.equal(accepted.query, 'original query');
assert.equal(accepted.mode, 'code');
assert(Object.isFrozen(accepted)); assert(Object.isFrozen(accepted.silver)); assert(Object.isFrozen(accepted.gold));
relevant[0].file = 'changed.js'; relevant.push({ name: 'later' }); gold[0].name = 'changed'; entry.query = 'changed';
assert.deepEqual(accepted.silver, [{ file: 'original.js' }]); assert.deepEqual(accepted.gold, [{ name: 'original' }]);
assert.equal(accepted.query, 'original query');
assert.deepEqual(captureEvaluationDatasetCases([{ query: 'unjudged' }])[0].silver, []);
assert.deepEqual(captureEvaluationDatasetCases([{ query: 'legacy', expect: [{ name: 'legacy' }] }])[0].silver, [{ name: 'legacy' }]);
assert.deepEqual(captureEvaluationDatasetCases([{ query: 'canonical empty', relevant: [], expect: [{ name: 'legacy' }] }])[0].silver, [],
  'a valid explicit empty relevant array keeps its canonical precedence');
console.log('Evaluation dataset judgment container controls authored; execution deferred.');
