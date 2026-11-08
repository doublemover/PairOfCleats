import assert from 'node:assert/strict';
import { buildTokenAndFieldPostings } from '../../../src/index/build/postings/token-field.js';
import { runPostingsWork, normalizeTfPostingsWork, sortPostingsWork } from '../../../src/index/build/postings/cooperative-work.js';
import { normalizeTfPostingList } from '../../../src/index/build/postings/id-lists.js';
import { buildPostings } from '../../../src/index/build/postings/index.js';

const rows = [[8, 1.8], [1, 3.2], [8, 0], null, [4, -1.7], [NaN, 2], [2, Infinity], [0, 5], [1, 2]];
for (const input of [[], [[1, 4], [1, 2]], rows, [...rows].reverse(), Array.from({ length: 65 }, (_, index) => [64 - index, index % 4])]) {
  const result = runPostingsWork(normalizeTfPostingsWork(input, 2), { requestYield: () => null, now: () => 0 });
  assert.ok(Array.isArray(result), 'no-yield normalization remains synchronous');
  assert.deepEqual(result, normalizeTfPostingList(input), 'independent legacy normalizer defines exact TF and equal-ID semantics');
}
const stable = [{ key: 'z', id: 0 }, { key: 'a', id: 1 }, { key: 'a', id: 2 }, { key: 'b', id: 3 }, { key: 'a', id: 4 }];
const compare = (left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
assert.deepEqual(runPostingsWork(sortPostingsWork([...stable], compare, 2), { now: () => 0 }), [...stable].sort(compare));

const make = ({ largeToken = true } = {}) => {
  const tokenPostings = new Map([['z', largeToken ? rows : [[0, 2]]], ['a', [[1, 4]]], ['b', [[0, 1]]], ['d', [[2, 1]]], ['c', [[1, 3]]]]);
  const fieldPostings = Object.create(null);
  Object.defineProperty(fieldPostings, '__proto__', { enumerable: true, value: new Map([['z', rows], ['a', [[1, 1]]], ['b', [[2, 2]]]]) });
  fieldPostings.body = new Map([['other', [[2, 1]]]]);
  return { sparseEnabled: true, tokenPostings, tokenIdMap: new Map([...tokenPostings.keys()].map(key => [key, key])),
    fieldPostings, fieldDocLengths: { ['__proto__']: [1, 2, NaN, 4, 5], body: [0, 3] }, normalizedDocLengths: [2, 3, 4], workBatchSize: 2 };
};
const expected = {
  tokenVocab: ['a', 'b', 'c', 'd', 'z'], tokenVocabIds: ['a', 'b', 'c', 'd', 'z'],
  tokenPostingsList: [[[1, 4]], [[0, 1]], [[1, 3]], [[2, 1]], normalizeTfPostingList(rows)], avgDocLen: 3,
  fieldPostingsResult: { fields: { ['__proto__']: { vocab: ['a', 'b', 'z'], postings: [[[1, 1]], [[2, 2]], normalizeTfPostingList(rows)],
    docLengths: [1, 2, 0, 4, 5], avgDocLen: 2.4, totalDocs: 5 },
  body: { vocab: ['other'], postings: [[[2, 1]]], docLengths: [0, 3], avgDocLen: 1.5, totalDocs: 2 } } }
};
const successful = make();
assert.deepEqual(await buildTokenAndFieldPostings({ ...successful, requestYield: () => null }), expected);
assert.equal(successful.tokenPostings.size, 0); assert.equal(successful.fieldPostings.body.size, 0);
await assert.rejects(buildTokenAndFieldPostings(successful), { code: 'ERR_POSTINGS_INPUT_CONSUMED' });
const empty = { sparseEnabled: true, tokenPostings: new Map(), fieldPostings: null, normalizedDocLengths: [] };
assert.deepEqual(await buildTokenAndFieldPostings(empty), await buildTokenAndFieldPostings(empty),
  'an originally empty map consumes no content and retains existing vector-only fixture behavior');

const preAborted = new AbortController(); preAborted.abort();
const untouched = make();
await assert.rejects(buildTokenAndFieldPostings({ ...untouched, signal: preAborted.signal }), { name: 'AbortError' });
assert.equal(untouched.tokenPostings.size, 5);
assert.deepEqual(await buildTokenAndFieldPostings(untouched), expected, 'pre-aborted admission consumes no source maps');
await assert.rejects(buildPostings({ chunks: [], abortSignal: preAborted.signal }), { name: 'AbortError' });

for (const phase of ['token-vocabulary', 'token-vocabulary-sort', 'posting-copy', 'posting-sort',
  'field-vocabulary', 'field-posting', 'field-lengths', 'before-success']) {
  const input = make(), controller = new AbortController();
  let stopped = false, matched = 0, laterWork = 0;
  const result = buildTokenAndFieldPostings({ ...input, signal: controller.signal, requestYield: event => {
    if (stopped) laterWork++;
    assert.ok(event.units <= 2, 'bounded source-copy/merge work between checks');
    if (event.phase === phase) {
      matched++; stopped = true; controller.abort(); return Promise.resolve();
    }
    return null;
  } });
  await assert.rejects(result, { name: 'AbortError' });
  assert.equal(matched, 1, phase); assert.equal(laterWork, 0, 'no later unit begins after observed cancellation');
  if (input.tokenPostings.size === 5) {
    assert.deepEqual(await buildTokenAndFieldPostings(input), expected, 'unconsumed token phase can retry only after settlement');
  } else {
    await assert.rejects(buildTokenAndFieldPostings(input), { code: 'ERR_POSTINGS_INPUT_CONSUMED' });
    assert.ok(input.fieldPostings.body.size > 0 || phase === 'before-success', 'later source ownership remains explicit');
  }
}

let release;
const gate = new Promise(resolve => { release = resolve; });
const waiting = make(), controller = new AbortController();
let yielded = false, settled = false;
const work = buildTokenAndFieldPostings({ ...waiting, signal: controller.signal, requestYield: () => {
  if (!yielded) { yielded = true; return gate; }
  return null;
} }).finally(() => { settled = true; });
const rejected = assert.rejects(work, { name: 'AbortError' });
try {
  controller.abort(); await Promise.resolve();
  assert.equal(settled, false, 'request cancellation cannot release an outstanding cooperative owner');
  await assert.rejects(buildTokenAndFieldPostings(waiting), { code: 'ERR_POSTINGS_INPUT_CONSUMED' });
} finally { release(); }
await rejected;
assert.deepEqual(await buildTokenAndFieldPostings(waiting), expected);
console.log('Token/field postings preserve exact artifacts and bounded cancellation with explicit consumed-input ownership.');
