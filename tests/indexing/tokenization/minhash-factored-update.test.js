#!/usr/bin/env node
import assert from 'node:assert/strict';
import { MINHASH_HASH_IDENTITY, SimpleMinHash } from '../../../src/index/minhash.js';
import { rankMinhash } from '../../../src/retrieval/rankers.js';
import { referenceMinhash } from '../../helpers/minhash-reference.js';

// Preserve the original recurrence as a reference for existing stored signatures.
class LegacyMinHash extends SimpleMinHash {
  hash(str, seed) {
    let value = seed;
    for (let i = 0; i < str.length; i += 1) {
      value = (value * 31 + str.charCodeAt(i)) >>> 0;
    }
    return value;
  }

  update(token) {
    this.seeds.forEach((seed, i) => {
      const value = this.hash(token, seed);
      if (value < this.hashValues[i]) this.hashValues[i] = value;
    });
  }
}

class ReferenceMinHash extends LegacyMinHash {
  hash(str, seed) { return referenceMinhash(str, seed); }
}

const alphabet = ['\0', 'x', '\ud800', '\uffff'];
const tokens = [''];
let level = [''];
for (let length = 1; length <= 4; length += 1) {
  level = level.flatMap((prefix) => alphabet.map((character) => prefix + character));
  tokens.push(...level);
}
tokens.push('👩🏽‍💻e\u0301'.repeat(64), '\uffff'.repeat(4096));
let random = 0x734f012a;
for (let sample = 0; sample < 100; sample += 1) {
  let token = '';
  for (let i = 0; i < sample * 3; i += 1) {
    random ^= random << 13;
    random ^= random >>> 17;
    random ^= random << 5;
    token += String.fromCharCode(random & 0xffff);
  }
  tokens.push(token);
}

let comparedValues = 0;
for (const width of [1, 16, 128]) {
  const actual = new SimpleMinHash(width);
  const reference = new ReferenceMinHash(width);
  for (const token of tokens) {
    actual.reset();
    reference.reset();
    actual.update(token);
    reference.update(token);
    assert.deepEqual(actual.hashValues, reference.hashValues);
    comparedValues += width;
  }
  actual.reset();
  reference.reset();
  for (const token of tokens) {
    actual.update(token);
    reference.update(token);
  }
  assert.deepEqual(actual.hashValues, reference.hashValues, 'multi-token minimum and reset must match the current family');
}

// Keep unusual public seeds, empty tokens, sparse arrays and custom hash behavior.
const seeds = [0, 1, 0xffffffff, -1, 1.5, Number.MAX_SAFE_INTEGER, '2', null, undefined];
const actual = new SimpleMinHash(seeds.length);
const reference = new ReferenceMinHash(seeds.length);
actual.seeds = [...seeds];
assert.equal(actual.hashIdentity, null, 'custom seed mappings cannot claim the persisted standard identity');
reference.seeds = [...seeds];
delete actual.seeds[1];
delete reference.seeds[1];
for (const token of ['', 'alpha', '\uffff'.repeat(32)]) {
  actual.reset();
  reference.reset();
  actual.update(token);
  reference.update(token);
  assert.deepEqual(actual.hashValues, reference.hashValues);
  for (const seed of seeds) assert.equal(actual.hash(token, seed), reference.hash(token, seed));
}
const custom = new SimpleMinHash(4);
let customCalls = 0;
custom.hash = (token, seed) => {
  customCalls += 1;
  return token.length + seed;
};
assert.equal(custom.hashIdentity, null, 'custom hash callbacks cannot claim the persisted standard identity');
custom.update('abc');
assert.deepEqual(custom.hashValues, [4, 5, 6, 7]);
assert.equal(customCalls, 4);
const tokenLike = { length: 2, charCodeAt: (index) => index + 65 };
actual.reset();
reference.reset();
actual.update(tokenLike);
reference.update(tokenLike);
assert.deepEqual(actual.hashValues, reference.hashValues);
assert.throws(() => new SimpleMinHash().update(null), TypeError);
new SimpleMinHash(0).update(null);

// Preserve all query/tie/filter comparisons against independent current signatures.
// Legacy polynomial bytes are deliberately incompatible and must require rebuild.
const corpus = [['alpha', 'beta'], ['alpha'], ['gamma', '👩🏽‍💻'], ['alpha', 'beta']];
const signature = (Type, words) => {
  const hash = new Type();
  for (const word of words) hash.update(word);
  return [...hash.hashValues];
};
const oldIndex = { minhash: { signatures: corpus.map((words) => signature(LegacyMinHash, words)) } };
const referenceIndex = { minhash: { hashIdentity: MINHASH_HASH_IDENTITY, signatures: corpus.map((words) => signature(ReferenceMinHash, words)) } };
const newIndex = { minhash: { hashIdentity: MINHASH_HASH_IDENTITY, signatures: corpus.map((words) => signature(SimpleMinHash, words)) } };
assert.deepEqual(newIndex, referenceIndex);
assert.notDeepEqual(newIndex.minhash.signatures, oldIndex.minhash.signatures);
assert.throws(() => rankMinhash(oldIndex, ['alpha'], 3), { code: 'ERR_ARTIFACT_INVALID', rebuildRequired: true });
for (const query of [['alpha'], ['alpha', 'beta'], ['👩🏽‍💻'], []]) {
  for (const candidateSet of [null, new Set([1, 2, 3])]) {
    const querySignature = signature(ReferenceMinHash, query);
    const expected = query.length ? referenceIndex.minhash.signatures
      .map((row, idx) => ({ idx, sim: row.filter((value, i) => value === querySignature[i]).length / row.length }))
      .filter(({ idx }) => !candidateSet || candidateSet.has(idx))
      .sort((a, b) => b.sim - a.sim || a.idx - b.idx)
      .slice(0, 3) : [];
    assert.deepEqual(rankMinhash(referenceIndex, query, 3, candidateSet), expected);
    assert.deepEqual(rankMinhash(newIndex, query, 3, candidateSet), expected);
  }
}

// Count work directly; timings and process RSS are not acceptance thresholds.
const token = 'locality-and-repeated-work';
const originalCharCodeAt = String.prototype.charCodeAt;
let reads = 0;
String.prototype.charCodeAt = function (index) {
  reads += 1;
  return originalCharCodeAt.call(this, index);
};
let legacyReads;
let actualReads;
try {
  new LegacyMinHash().update(token);
  legacyReads = reads;
  reads = 0;
  new SimpleMinHash().update(token);
  actualReads = reads;
} finally {
  String.prototype.charCodeAt = originalCharCodeAt;
}
assert.equal(legacyReads, 128 * token.length);
assert.equal(actualReads, token.length, 'ordinary tokens should be read once across all hash seeds');
console.log(`minhash factored update passed: ${comparedValues} signature values; character reads ${legacyReads} -> ${actualReads}`);
