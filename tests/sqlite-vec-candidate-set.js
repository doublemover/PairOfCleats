#!/usr/bin/env node
import assert from 'node:assert';
import { queryVectorAnn } from '../tools/vector-extension.js';

const config = {
  enabled: true,
  table: 'dense_vectors_ann',
  column: 'embedding',
  encoding: 'float32'
};

let currentRows = [];
let lastSql = null;
let lastParams = null;

const db = {
  prepare: (sql) => {
    lastSql = sql;
    return {
      all: (...params) => {
        lastParams = params;
        return currentRows;
      }
    };
  }
};

currentRows = [
  { rowid: 2, distance: 0.5 },
  { rowid: 3, distance: 0.1 },
  { rowid: 1, distance: 0.1 }
];
const smallCandidates = new Set([1, 2, 3]);
const smallHits = queryVectorAnn(db, config, [0, 1], 2, smallCandidates);
assert.ok(lastSql.includes('rowid IN'), 'expected candidate pushdown for small set');
assert.ok(lastSql.includes('ORDER BY distance'), 'expected distance ordering');
assert.equal(smallHits[0].idx, 1, 'expected rowid tie-break on distance');
assert.equal(smallHits[1].idx, 3, 'expected rowid tie-break on distance');

const largeCandidates = new Set(Array.from({ length: 901 }, (_, i) => i));
currentRows = [
  { rowid: 2000, distance: 0.05 },
  { rowid: 10, distance: 0.1 }
];
lastSql = null;
lastParams = null;
const largeHits = queryVectorAnn(db, config, [0, 1], 2, largeCandidates);
assert.ok(!lastSql.includes('rowid IN'), 'expected fallback query for large set');
assert.equal(largeHits.length, 1, 'expected candidate filtering for large set');
assert.equal(largeHits[0].idx, 10, 'expected candidate filtering for large set');
assert.ok(Array.isArray(lastParams), 'expected SQL parameters for ANN query');

const badConfig = {
  ...config,
  column: 'embedding;drop'
};
lastSql = null;
lastParams = null;
const badHits = queryVectorAnn(db, badConfig, [0, 1], 2, smallCandidates);
assert.equal(badHits.length, 0, 'expected invalid column to return no results');
assert.equal(lastSql, null, 'expected invalid column to skip query execution');

console.log('sqlite vec candidate set test passed');
