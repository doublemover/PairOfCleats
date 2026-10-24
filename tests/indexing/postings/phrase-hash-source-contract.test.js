import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildPhraseAndChargramPostings } from '../../../src/index/build/postings/phrase-chargram.js';
import { compareChargramRows, createSpillHelpers } from '../../../src/index/build/postings/spill.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

// AUTHORED lazy hashed source/fallback/threshold contract. Execution deferred.
const { dir } = await prepareIsolatedTestCacheDir('phrase-hash-source-contract');
const build = async (label, input = {}) => {
  const buildRoot = path.join(dir, label);
  await fs.mkdir(buildRoot, { recursive: true });
  const result = await buildPhraseAndChargramPostings({ phraseEnabled: true,
    chargramEnabled: false, phraseHashEnabled: true, buildRoot,
    compareChargramRows, ...createSpillHelpers({ buildRoot }), ...input });
  assert.deepEqual(await fs.readdir(buildRoot), []);
  return result;
};
const hashEntries = () => new Map([
  ['single', { kind: 'single', ids: [0, 'missing'], posting: [9, 1, 9, NaN] }],
  ['collision', { kind: 'collision', entries: [
    { ids: ['alias-a', 'alias-b'], posting: [7, 7] },
    { ids: ['alias-a2', 'alias-b2'], posting: [6, 6] },
    { ids: ['empty', 'empty2'], posting: [] },
    { ids: [], posting: [8] }
  ] }]
]);
const tokenIdMap = new Map([[0, ''], ['alias-a', 'same'], ['alias-b', 'key'],
  ['alias-a2', 'same'], ['alias-b2', 'key'], ['empty', 'empty'], ['empty2', 'posting']]);
try {
  for (const buckets of [undefined, null, new Map()]) {
    const phrasePost = new Map([['legacy\u0001fallback', [2, 2, 1]]]);
    const result = await build(`fallback-${buckets === undefined ? 'absent' : buckets === null ? 'null' : 'empty'}`,
      { phrasePost, phrasePostHashBuckets: buckets });
    assert.deepEqual(result.phraseVocab, ['legacy\u0001fallback']);
    assert.deepEqual(result.phrasePostings, [[1, 2]]);
    assert.equal(result.phraseStats.source, 'string-map');
    assert.equal(phrasePost.size, 0);
  }
  for (const phraseHashEnabled of [false, true]) {
    const buckets = hashEntries();
    const phrasePost = new Map([['legacy', [1]]]);
    const disabled = await build(`disabled-${phraseHashEnabled}`, { phraseEnabled: false,
      phraseHashEnabled, phrasePostHashBuckets: buckets, phrasePost,
      tokenIdMap: { get() { throw new Error('disabled phrase source must remain untouched'); } } });
    assert.deepEqual(disabled.phraseVocab, []);
    assert.equal(disabled.phraseStats, null);
    assert.equal(buckets.size, 2); assert.equal(phrasePost.size, 1);
  }
  const result = await build('token-map-resolution', { phrasePostHashBuckets: hashEntries(), tokenIdMap });
  assert.deepEqual(result.phraseVocab, ['0\u0001missing', 'empty\u0001posting', 'same\u0001key', 'same\u0001key']);
  assert.deepEqual(result.phrasePostings, [[1, 9], [], [7], [6]], 'preserve hashed equal-key order and empty rows');
  const withoutDirectory = await build('without-directory', { buildRoot: null,
    phrasePostHashBuckets: hashEntries(), tokenIdMap, phraseSpillMaxBytes: 1, phraseSpillMaxUnique: 1 });
  assert.deepEqual(withoutDirectory.phraseVocab, result.phraseVocab);
  assert.deepEqual(withoutDirectory.phrasePostings, result.phrasePostings);
  assert.equal(withoutDirectory.phraseStats.spillAllowed, false);
  assert.equal(withoutDirectory.phraseStats.spillEnabled, false);

  const twoRows = () => new Map([['collision', { kind: 'collision', entries: [
    { ids: ['a', 'b'], posting: [0] }, { ids: ['c', 'd'], posting: [1] }
  ] }]]);
  const serializedBytes = Buffer.byteLength(JSON.stringify({ token: 'a\u0001b', postings: [0], order: 0 })) + 1
    + Buffer.byteLength(JSON.stringify({ token: 'c\u0001d', postings: [1], order: 1 })) + 1;
  for (const hashed of [false, true]) {
    for (const threshold of [1, 2, 3]) {
      const unique = await build(`unique-${hashed}-${threshold}`, { phraseHashEnabled: hashed,
        phrasePostHashBuckets: twoRows(), phrasePost: new Map([['a\u0001b', [0]], ['c\u0001d', [1]]]),
        phraseSpillMaxUnique: threshold });
      assert.equal(unique.phraseStats.spillEnabled, threshold <= 2, 'inclusive row threshold counts collision entries');
      assert.equal(unique.phraseStats.inputRows, 2);
    }
    for (const threshold of [serializedBytes - 1, serializedBytes, serializedBytes + 1]) {
      const bytes = await build(`bytes-${hashed}-${threshold}`, { phraseHashEnabled: hashed,
        phrasePostHashBuckets: twoRows(), phrasePost: new Map([['a\u0001b', [0]], ['c\u0001d', [1]]]),
        phraseSpillMaxBytes: threshold });
      assert.equal(bytes.phraseStats.inputSerializedBytes, serializedBytes);
      assert.equal(bytes.phraseStats.spillEnabled, threshold <= serializedBytes, 'inclusive actual JSONL byte threshold');
    }
  }

  // Existing hashed duplicate-key ordering must survive multiple actual runs.
  const aliases = new Map(), entries = [];
  for (let i = 0; i < 5001; i++) {
    aliases.set(i, 'same'); entries.push({ ids: [i, 'key'], posting: i === 2500 ? [] : [5001 - i] });
  }
  const spilledAliases = await build('spilled-aliases', { tokenIdMap: aliases,
    phrasePostHashBuckets: new Map([['collision', { kind: 'collision', entries }]]), phraseSpillMaxUnique: 1 });
  assert.equal(spilledAliases.phraseStats.spillRuns, 2);
  assert.equal(spilledAliases.phraseVocab.length, 5001, 'equal resolved strings are not collapsed');
  assert.ok(spilledAliases.phraseVocab.every(token => token === 'same\u0001key'));
  assert.deepEqual(spilledAliases.phrasePostings, entries.map(entry => entry.posting));
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('lazy phrase source preserves fallback, disabled state, token resolution and inclusive spill boundaries');
