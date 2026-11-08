import assert from 'node:assert/strict';
import { createCandidateHelpers } from '../../../src/retrieval/output/filters/candidates.js';

const large = new Set(Array.from({ length: 256 }, (_, index) => index));
const small = new Set([255, 256]);
const expected = Array.from({ length: 257 }, (_, index) => index);
for (const preferBitmap of [undefined, false, true]) {
  for (const decline of [false, true]) {
    const conversions = [];
    const helpers = createCandidateHelpers({ roaringAvailable: true, preferBitmap,
      bitmapToSet: bitmap => new Set(bitmap),
      unionBitmaps: bitmaps => new Set(bitmaps.flatMap(bitmap => [...bitmap])),
      createBitmapFromIds: (ids, options) => {
        conversions.push(options.force);
        return !ids.length || decline || !options.force && ids.length < 256 ? null : new Set(ids);
      }
    });
    const result = helpers.buildCandidate([small], [large]);
    assert.deepEqual([...(result.bitmap || result.set)].sort((a, b) => a - b), expected);
    assert.deepEqual(conversions, [true], 'mixed unions force the small conversion independently of output preference');
    assert.deepEqual([...small], [255, 256]); assert.equal(large.size, 256);
    assert.equal(helpers.buildCandidate([], []), null);
    assert.deepEqual([...helpers.buildCandidate([new Set()], []).set], []);
    const setOnly = helpers.buildCandidate([small], []);
    assert.deepEqual([...(setOnly.bitmap || setOnly.set)], [255, 256]);
  }
}
console.log('Mixed bitmap/Set candidate unions preserve exact membership, fallback and input ownership.');
