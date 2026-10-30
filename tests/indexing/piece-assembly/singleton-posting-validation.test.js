import assert from 'node:assert/strict';
import { normalizeTfPostings } from '../../../src/index/build/piece-assembly/helpers.js';

for (const invalid of [['invalid', -1], [NaN, 1], [1, Infinity], null, 7]) {
  assert.deepEqual(normalizeTfPostings([invalid]), [], 'singleton admission uses the same validation as longer lists');
  assert.deepEqual(normalizeTfPostings([invalid, [2, 3]]), [[2, 3]]);
}
assert.deepEqual(normalizeTfPostings([]), []);
assert.deepEqual(normalizeTfPostings([[2, 3.8]]), [[2, 3]], 'singleton counts receive the existing normalization');
assert.deepEqual(normalizeTfPostings([[4, 1], [2, 3]]), [[2, 3], [4, 1]]);
console.log('Piece singleton posting admission matches empty and multiple-row normalization.');
