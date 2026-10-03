#!/usr/bin/env node
import assert from 'node:assert/strict';

import { rankDenseVectors } from '../../../src/retrieval/rankers.js';

const cases = [
  {
    name: 'binary-buffer dense vectors rank expected document first',
    run() {
      const dims = 2;
      const scale = 2 / 255;
      const minVal = -1;
      const buffer = new Uint8Array([
        255, 128,
        128, 255
      ]);
      const idx = {
        denseVec: {
          dims,
          scale,
          minVal,
          maxVal: 1,
          levels: 256,
          buffer
        }
      };
      const results = rankDenseVectors(idx, [1, 0], 2, null);
      assert.equal(results.length, 2);
      assert.equal(results[0].idx, 0);
    }
  },
  {
    name: 'dimension mismatch truncates consistently and warns once',
    run() {
      const idx = {
        denseVec: {
          dims: 2,
          scale: 1,
          vectors: [new Uint8Array([2, 2])]
        }
      };
      const query = [1, 2, 3];
      let warnings = 0;
      const originalWarn = console.warn;
      console.warn = () => {
        warnings += 1;
      };
      try {
        const hitsA = rankDenseVectors(idx, query, 1, null);
        const hitsB = rankDenseVectors(idx, query, 1, null);
        assert.equal(hitsA.length, 1);
        assert.equal(hitsB.length, 1);
        assert.ok(Math.abs(hitsA[0].sim - 3) < 1e-9);
        assert.equal(warnings, 1);
      } finally {
        console.warn = originalWarn;
      }
    }
  }
];

for (const testCase of cases) {
  testCase.run();
}

console.log('dense ranking contract matrix test passed');
