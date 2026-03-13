#!/usr/bin/env node
import assert from 'node:assert/strict';
import { queryVectorAnn } from '../../../tools/sqlite/vector-extension.js';
import { getMetricsText } from '../../../src/shared/metrics.js';

const sqlStatements = [];
const inserted = [];
let queryParams = null;

const db = {
  exec(sql) {
    sqlStatements.push(sql);
  },
  prepare(sql) {
    sqlStatements.push(sql);
    if (sql.startsWith('INSERT OR IGNORE')) {
      return {
        run(id) {
          inserted.push(id);
        }
      };
    }
    return {
      all(...params) {
        queryParams = params;
        return [];
      }
    };
  },
  transaction(fn) {
    return (...args) => fn(...args);
  }
};

const candidateSet = new Set(Array.from({ length: 1200 }, (_, i) => i));
const config = {
  enabled: true,
  table: 'dense_vectors_ann',
  column: 'embedding',
  encoding: 'float32',
  dims: 4
};

queryVectorAnn(db, config, [1, 2, 3, 4], 7, candidateSet);

assert.ok(
  sqlStatements.some((sql) => sql.includes('CREATE TEMP TABLE IF NOT EXISTS __poc_ann_candidates_')),
  'expected temp candidate table creation for large candidate sets'
);
assert.ok(
  sqlStatements.some((sql) => sql.includes('IN (SELECT id FROM __poc_ann_candidates_')),
  'expected ANN query to use temp-table pushdown'
);
assert.ok(
  sqlStatements.some((sql) => sql.includes('DROP TABLE IF EXISTS __poc_ann_candidates_')),
  'expected temp candidate table cleanup'
);
assert.equal(inserted.length, candidateSet.size, 'expected all candidate ids inserted into temp table');
assert.ok(Array.isArray(queryParams) && queryParams.length === 2, 'expected encoded vector + limit params');
assert.equal(queryParams[1], 7, 'expected exact topN limit when pushdown is active');
const metrics = await getMetricsText();
assert.match(
  metrics,
  /pairofcleats_ann_candidate_pushdown_total\{backend="sqlite-vector",strategy="temp-table",size_bucket="1025\+"\} 1/,
  'expected temp-table pushdown metric increment'
);

console.log('vector extension large candidate pushdown test passed');
