import assert from 'node:assert/strict';
import { SimpleMinHash } from '../../../src/index/minhash.js';

const referenceHash = (text, seed) => {
  let value = seed;
  for (let index = 0; index < text.length; index += 1) {
    value = (value * 31 + text.charCodeAt(index)) >>> 0;
  }
  return value;
};
const tokens = ['', 'a', '\0', '\r\n', '😀', '\ud800', 'é', 'a'.repeat(257)];
let random = 12345;
for (let row = 0; row < 300; row += 1) {
  let token = '';
  for (let index = 0; index < row % 23; index += 1) {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    token += String.fromCharCode(random & 0xffff);
  }
  tokens.push(token);
}
for (const width of [0, 1, 16, 128]) {
  const actual = new SimpleMinHash(width);
  const expected = Array(width).fill(Infinity);
  for (const token of tokens) {
    actual.update(token);
    for (let index = 0; index < width; index += 1) {
      expected[index] = Math.min(expected[index], referenceHash(token, index + 1));
    }
    assert.deepEqual(actual.hashValues, expected);
  }
  actual.reset();
  assert.deepEqual(actual.hashValues, Array(width).fill(Infinity));
}
const unusual = new SimpleMinHash(7);
unusual.seeds = [0, 0xffffffff, -1, 1.5, 0x100000000, NaN, '2'];
for (const token of tokens) {
  unusual.reset();
  unusual.update(token);
  assert.deepEqual(unusual.hashValues, unusual.seeds.map((seed) => {
    const value = referenceHash(token, seed);
    return value < Infinity ? value : Infinity;
  }));
}
const custom = new SimpleMinHash(3);
const calls = [];
custom.hash = (token, seed) => { calls.push([token, seed]); return seed + 10; };
custom.update('custom');
assert.deepEqual(custom.hashValues, [11, 12, 13]);
assert.deepEqual(calls, [['custom', 1], ['custom', 2], ['custom', 3]]);
const objectToken = { length: 2, charCodeAt: (index) => [65, 66][index] };
const objectHash = new SimpleMinHash(3);
objectHash.update(objectToken);
assert.deepEqual(objectHash.hashValues, [1, 2, 3].map((seed) => referenceHash(objectToken, seed)));

const originalCharCodeAt = String.prototype.charCodeAt;
let characterReads = 0;
try {
  String.prototype.charCodeAt = function counted(index) {
    characterReads += 1;
    return originalCharCodeAt.call(this, index);
  };
  new SimpleMinHash(128).update('bounded-work');
} finally {
  String.prototype.charCodeAt = originalCharCodeAt;
}
assert.equal(characterReads, 'bounded-work'.length);
console.log(`MinHash parity passed; character reads ${characterReads}, legacy ${128 * characterReads}`);
