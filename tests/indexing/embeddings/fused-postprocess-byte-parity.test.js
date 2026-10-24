import assert from 'node:assert/strict';
import { postprocessEmbeddingChannels } from '../../../src/shared/embedding-postprocess.js';
import { mergeEmbeddingVectors, normalizeEmbeddingVector } from '../../../src/shared/embedding-vector-utils.js';
import { quantizeEmbeddingVectorUint8 } from '../../../src/shared/embedding-quantization.js';

const legacy = ({ codeVector: code, docVector: doc, normalize, quantization }) => {
  const merged = mergeEmbeddingVectors({ codeVector: code, docVector: doc });
  const encode = vector => quantizeEmbeddingVectorUint8(normalize ? normalizeEmbeddingVector(vector) : vector,
    quantization.minVal, quantization.maxVal, quantization.levels);
  return { quantizedCode: encode(code), quantizedDoc: encode(doc), quantizedMerged: encode(merged) };
};
const originals = [[], [0, 0, 0], [1, 0, 0], [-1, 0, 1], [0.123456789012, -0.444444444444, 0.999999999999],
  [0.00000001, -0.00000001, 0.00000002], [0.5 + Number.EPSILON, -0.5, 0.5 - Number.EPSILON]];
const warnings = [], originalWarn = console.warn;
try {
  console.warn = warning => warnings.push(String(warning));
  for (const Constructor of [Array, Float32Array, Float64Array]) {
    for (const normalize of [false, true]) for (const quantization of [
      { minVal: -1, maxVal: 1, levels: 256 }, { minVal: -2, maxVal: 2, levels: 17 }, { minVal: -1, maxVal: 1, levels: 2 }
    ]) for (const source of originals) for (const docSource of [[], source.map(value => value / 3)]) {
      const codeVector = Constructor.from(source), docVector = Constructor.from(docSource);
      const beforeCode = Array.from(codeVector), beforeDoc = Array.from(docVector);
      const input = { codeVector, docVector, normalize, quantization };
      const actual = postprocessEmbeddingChannels(input), expected = legacy(input);
      for (const channel of Object.keys(expected)) assert.deepEqual(actual[channel], expected[channel], `${Constructor.name} ${normalize} ${channel}`);
      assert.deepEqual(Array.from(codeVector), beforeCode); assert.deepEqual(Array.from(docVector), beforeDoc);
      assert.notEqual(actual.quantizedCode.buffer, actual.quantizedMerged.buffer, 'encoded channel ownership stays independent');
      if (actual.quantizedCode.length) {
        const mergedBefore = actual.quantizedMerged.slice();
        actual.quantizedCode.fill(0);
        assert.deepEqual(actual.quantizedMerged, mergedBefore, 'backend mutation of one output cannot affect a sibling channel');
      }
    }
  }
} finally { console.warn = originalWarn; }
assert.ok(warnings.length > 0, 'boundary cases exercise expected quantization-clamp diagnostics');
assert.ok(warnings.every(warning => warning.startsWith('[embeddings] Quantization clamped')));
for (const invalid of [NaN, Infinity, -Infinity, '1']) assert.throws(() => postprocessEmbeddingChannels({ codeVector: [invalid] }), /Non-finite/);
assert.throws(() => postprocessEmbeddingChannels({ codeVector: [1, 2], docVector: [1] }), /dims mismatch/);
assert.equal(postprocessEmbeddingChannels({ codeVector: Float32Array.of(1, 0), docVector: [] }).quantizedDoc.length, 0);
console.log('Fused postprocessing preserves Float32 rounding, quantized bytes, missing channels and independent buffer ownership.');
