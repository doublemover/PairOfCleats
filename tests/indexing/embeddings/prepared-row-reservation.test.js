import assert from 'node:assert/strict';
import { createPreparedTokenRows, createTokenizationIdentity, prepareTokenRowsWithCache } from '../../../src/shared/onnx-embeddings/tokenization.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('indexing/embeddings/prepared-row-reservation/')[1];
assert.ok(['pre-tokenizer-capacity', 'pending-and-committed-accounting', 'retained-read-and-original-release',
  'geometry-before-copy', 'expiry-and-failed-commit'].includes(mode));
const tokenizer = texts => ({ input_ids: texts.map(() => [1, 2]), attention_mask: texts.map(() => [1, 1]) });
const identity = createTokenizationIdentity({ tokenizer });
const reserve = (store, texts = ['one'], maxLength = 2) => store.reserve({ texts, identity, maxLength });
const zero = store => {
  const stats = store.stats(); assert.equal(stats.entries, 0); assert.equal(stats.bytes, 0);
  assert.equal(stats.reservedBytes, 0); assert.equal(stats.reservedEntries, 0); assert.equal(stats.reservations, 0);
};
if (mode === 'pre-tokenizer-capacity') {
  const store = createPreparedTokenRows({ maxEntries: 2, maxBytes: 1024 }); let calls = 0;
  const prepare = (texts, maxLength) => {
    const admission = store.reserve({ texts, identity, maxLength }); if (!admission) return null;
    calls++; const rows = prepareTokenRowsWithCache({ tokenizer, texts, rowLengthLimit: maxLength });
    return admission.commit(rows);
  };
  for (const length of [undefined, null, Infinity, NaN, 0, -1, Number.MAX_SAFE_INTEGER]) assert.equal(prepare(['one'], length), null);
  assert.equal(prepare(['one', 'two', 'three'], 2), null); assert.equal(prepare(['x'.repeat(1024)], 2), null);
  assert.equal(calls, 0); zero(store);
  const release = prepare(['one'], 2); assert.equal(calls, 1); assert.equal(typeof release, 'function'); release(); zero(store);
} else if (mode === 'pending-and-committed-accounting') {
  const store = createPreparedTokenRows({ maxEntries: 2, maxBytes: 1024 });
  const first = reserve(store, ['one'], 40); assert.ok(first);
  assert.ok(store.stats().reservedBytes > 640); assert.equal(reserve(store, ['two'], 40), null);
  const release = first.commit(prepareTokenRowsWithCache({ tokenizer, texts: ['one'] }));
  assert.equal(store.stats().reservedBytes, 0); assert.ok(store.stats().bytes < 300);
  const second = reserve(store, ['two'], 2); assert.ok(second);
  assert.equal(reserve(store, ['three'], 2), null, 'pending keys and committed entries share one entry cap');
  assert.deepEqual(store.read('one', identity).input_ids, [1, 2]);
  second.release(); release(); zero(store);
} else if (mode === 'retained-read-and-original-release') {
  const store = createPreparedTokenRows();
  const admission = reserve(store, ['same', 'same']); assert.ok(admission);
  const rows = prepareTokenRowsWithCache({ tokenizer, texts: ['same', 'same'] });
  const release = admission.commit(rows); assert.equal(store.stats().entries, 1);
  assert.equal(store.read('same', identity), rows[0]); assert.equal(store.read('same', identity), rows[0]);
  assert.equal(store.read('same', identity + '-other'), null);
  assert.equal(reserve(store, ['same']), null, 'live row authority is not replaced');
  release(); const newer = reserve(store, ['same']); assert.ok(newer); newer.commit(rows.slice(0, 1));
  release(); assert.equal(store.stats().entries, 1); newer.release(); zero(store);
} else if (mode === 'geometry-before-copy') {
  let reads = 0; const oversized = [1, 2, 3]; Object.defineProperty(oversized, 0, { get() { reads++; return 1; } });
  assert.throws(() => prepareTokenRowsWithCache({ tokenizer: () => ({ input_ids: [oversized] }), texts: ['one'], rowLengthLimit: 2 }), { code: 'ERR_ONNX_TOKENIZER_OUTPUT' });
  assert.equal(reads, 0, 'oversized native rows are rejected before normalization copies their token cells');
  for (const limit of [NaN, Infinity, 0, 1.5]) assert.throws(() => prepareTokenRowsWithCache({ tokenizer, texts: ['one'], rowLengthLimit: limit }), { code: 'ERR_ONNX_TOKENIZER_OUTPUT' });
  const store = createPreparedTokenRows(); const admission = reserve(store);
  assert.throws(() => admission.commit([{ input_ids: [1, 2, 3], attention_mask: [1, 1, 1], token_type_ids: null }]), { code: 'ERR_ONNX_TOKENIZER_OUTPUT' });
  assert.equal(store.stats().entries, 0); admission.release(); zero(store);
} else {
  const originalNow = Date.now; let clock = originalNow(); const store = createPreparedTokenRows({ ttlMs: 100 });
  Date.now = () => clock;
  try {
    const pending = reserve(store); clock += 100;
    assert.throws(() => pending.commit(prepareTokenRowsWithCache({ tokenizer, texts: ['one'] })), { code: 'ERR_ONNX_TOKENIZER_OUTPUT' }); zero(store);
    const committed = reserve(store); committed.commit(prepareTokenRowsWithCache({ tokenizer, texts: ['one'] }));
    clock += 99; assert.ok(store.read('one', identity)); clock++;
    assert.equal(store.read('one', identity), null); zero(store);
    const failed = reserve(store); assert.throws(() => failed.commit([]), { code: 'ERR_ONNX_TOKENIZER_OUTPUT' });
    failed.release(); zero(store);
  } finally { Date.now = originalNow; store.clear(); }
}
console.log('Prepared row reservations admit projected token cells before allocation and retain their original bounded lease.');
