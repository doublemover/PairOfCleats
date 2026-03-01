#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createSqliteHelpers } from '../../../src/retrieval/sqlite-helpers.js';

const denseRows = [{ doc_id: 0, vector: new Uint8Array([2, 2]) }];

const db = {
  prepare: (sql) => {
    if (sql.startsWith('SELECT MAX(id)')) {
      return { get: () => ({ maxId: 0 }) };
    }
    if (sql.startsWith('SELECT dims')) {
      return { get: () => ({}) };
    }
    if (sql.startsWith('SELECT doc_id, vector FROM dense_vectors')) {
      return {
        iterate: function* () {
          yield* denseRows;
        }
      };
    }
    if (sql.startsWith('SELECT doc_id, sig FROM minhash_signatures')) {
      return {
        iterate: function* () {}
      };
    }
    return {
      all: () => [],
      get: () => ({}),
      iterate: function* () {}
    };
  }
};

const vectorAnnState = {
  code: { available: false },
  prose: { available: false },
  records: { available: false },
  'extracted-prose': { available: false }
};

const helpers = createSqliteHelpers({
  getDb: () => db,
  postingsConfig: { chargramMinN: 3, chargramMaxN: 3 },
  sqliteFtsWeights: [],
  vectorExtension: {},
  vectorAnnState,
  queryVectorAnn: () => [],
  modelIdDefault: 'stub',
  fileChargramN: 3
});

const idx = helpers.loadIndexFromSqlite('code', {
  includeChunks: false,
  includeMinhash: false,
  includeFilterIndex: false
});

assert.ok(idx.denseVec, 'expected dense vectors to load');
assert.equal(idx.denseVec.scale, 2 / 255);
assert.equal(idx.denseVec.minVal, -1);
assert.equal(idx.denseVec.dims, 2);

console.log('sqlite dense meta fallback test passed');
