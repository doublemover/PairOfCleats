#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { ensureVocabIds, fetchVocabRows } from '../../../../src/storage/sqlite/vocab.js';

applyTestEnv();

const tables = new Map([
  ['token_vocab', new Map([
    ['alpha', 0],
    ['beta', 1],
    ['gamma', 2]
  ])]
]);

let prepareCalls = 0;
const db = {
  prepare(sql) {
    prepareCalls += 1;
    const source = String(sql || '');
    if (source.includes('COUNT(*) AS total')) {
      return {
        get(mode) {
          void mode;
          const table = source.match(/FROM\s+([a-z_]+)/i)?.[1];
          return { total: tables.get(table)?.size || 0 };
        }
      };
    }
    if (source.includes('MAX(')) {
      return {
        get(mode) {
          void mode;
          const table = source.match(/FROM\s+([a-z_]+)/i)?.[1];
          const ids = Array.from((tables.get(table) || new Map()).values());
          const maxId = ids.length ? Math.max(...ids) : null;
          return { maxId };
        }
      };
    }
    if (source.includes(' AS id') && source.includes(' AS value')) {
      const table = source.match(/FROM\s+([a-z_]+)/i)?.[1];
      return {
        all(mode, ...values) {
          void mode;
          const tableMap = tables.get(table) || new Map();
          const out = [];
          for (const value of values) {
            if (!tableMap.has(value)) continue;
            out.push({ id: tableMap.get(value), value });
          }
          return out;
        }
      };
    }
    return {
      run() {},
      all() { return []; },
      get() { return {}; }
    };
  },
  transaction(fn) {
    return (...args) => fn(...args);
  }
};

const rows = fetchVocabRows(db, 'code', 'token_vocab', 'token_id', 'token', [
  'alpha',
  'beta',
  'alpha',
  '',
  null
]);
assert.equal(rows.length, 2);
assert.deepEqual(rows.map((row) => row.value).sort(), ['alpha', 'beta']);

const prepareAfterFirstFetch = prepareCalls;
fetchVocabRows(db, 'code', 'token_vocab', 'token_id', 'token', ['beta', 'gamma']);
assert.equal(
  prepareCalls,
  prepareAfterFirstFetch,
  'expected cached vocab statement reuse for same table/id/value/arity'
);

const inserted = [];
const insertStmt = {
  run(mode, id, value) {
    inserted.push([mode, id, value]);
    const table = tables.get('token_vocab');
    table.set(value, id);
  }
};
const ensured = ensureVocabIds(
  db,
  'code',
  'token_vocab',
  'token_id',
  'token',
  ['gamma', 'delta', 'epsilon', 'delta'],
  insertStmt
);
assert.equal(ensured.inserted, 2);
assert.equal(ensured.map.get('gamma'), 2);
assert.equal(typeof ensured.map.get('delta'), 'number');
assert.equal(typeof ensured.map.get('epsilon'), 'number');
assert.deepEqual(
  inserted.map((row) => row[2]).sort(),
  ['delta', 'epsilon']
);

console.log('sqlite vocab fetch parity test passed');
