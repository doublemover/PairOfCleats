#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveSparseFallbackModesWithoutAnn } from '../../../src/retrieval/cli.js';

const sparseMissingByMode = {
  code: ['token_vocab', 'token_postings']
};

const missingWithoutAnn = await resolveSparseFallbackModesWithoutAnn({
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

const missingWithDenseLoaderOnly = await resolveSparseFallbackModesWithoutAnn({
  sparseMissingByMode,
  idxByMode: {
    code: {
      minhash: null,
      denseVec: null,
      loadDenseVectors: async () => null
    }
  },
  vectorAnnState: { code: { available: false } },
  hnswAnnState: { code: { available: false } },
  lanceAnnState: { code: { available: false } }
});

assert.deepEqual(
  missingWithDenseLoaderOnly,
  ['code'],
  'expected loader-only mode to remain unavailable when dense vectors are missing'
);

const missingWithFailingDenseLoader = await resolveSparseFallbackModesWithoutAnn({
  sparseMissingByMode,
  idxByMode: {
    code: {
      minhash: null,
      denseVec: null,
      loadDenseVectors: async () => {
        throw new Error('dense vectors unavailable');
      }
    }
  },
  vectorAnnState: { code: { available: false } },
  hnswAnnState: { code: { available: false } },
  lanceAnnState: { code: { available: false } }
});

assert.deepEqual(
  missingWithFailingDenseLoader,
  ['code'],
  'expected failing dense loader to be treated as unavailable ANN path'
);

const availableWithDenseLoader = await resolveSparseFallbackModesWithoutAnn({
  sparseMissingByMode,
  idxByMode: {
    code: {
      minhash: null,
      denseVec: null,
      loadDenseVectors: async function loadDenseVectors() {
        this.denseVec = { vectors: [[0.1, 0.2, 0.3]] };
        return this.denseVec;
      }
    }
  },
  vectorAnnState: { code: { available: false } },
  hnswAnnState: { code: { available: false } },
  lanceAnnState: { code: { available: false } }
});

assert.deepEqual(
  availableWithDenseLoader,
  [],
  'expected mode to be available when lazy loader materializes dense vectors'
);

const availableWithMinhash = await resolveSparseFallbackModesWithoutAnn({
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

const availableWithProvider = await resolveSparseFallbackModesWithoutAnn({
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
