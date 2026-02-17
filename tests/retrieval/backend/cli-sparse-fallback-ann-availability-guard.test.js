#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveSparseFallbackModesWithoutAnn } from '../../../src/retrieval/cli.js';

const sparseMissingByMode = {
  code: ['token_vocab', 'token_postings']
};

const missingWithoutAnn = resolveSparseFallbackModesWithoutAnn({
  sparseMissingByMode,
  idxByMode: {
    code: {
      minhash: null,
      denseVec: null,
      loadDenseVectors: null
    }
  },
  vectorAnnState: { code: { available: false } },
  hnswAnnState: { code: { available: false } },
  lanceAnnState: { code: { available: false } }
});

assert.deepEqual(
  missingWithoutAnn,
  ['code'],
  'expected mode to be marked unavailable when sparse fallback has no ANN path'
);

const availableWithMinhash = resolveSparseFallbackModesWithoutAnn({
  sparseMissingByMode,
  idxByMode: {
    code: {
      minhash: { signatures: [[1, 2, 3]] },
      denseVec: null,
      loadDenseVectors: null
    }
  },
  vectorAnnState: { code: { available: false } },
  hnswAnnState: { code: { available: false } },
  lanceAnnState: { code: { available: false } }
});

assert.deepEqual(
  availableWithMinhash,
  [],
  'expected minhash signatures to satisfy ANN fallback availability'
);

const availableWithProvider = resolveSparseFallbackModesWithoutAnn({
  sparseMissingByMode,
  idxByMode: {
    code: {
      minhash: null,
      denseVec: null,
      loadDenseVectors: null
    }
  },
  vectorAnnState: { code: { available: true } },
  hnswAnnState: { code: { available: false } },
  lanceAnnState: { code: { available: false } }
});

assert.deepEqual(
  availableWithProvider,
  [],
  'expected ANN provider availability to satisfy sparse fallback availability'
);

console.log('cli sparse fallback ANN availability guard test passed');
