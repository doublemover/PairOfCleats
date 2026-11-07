#!/usr/bin/env node
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { CREATE_TABLES_BASE_SQL } from '../../../src/storage/sqlite/schema.js';
import { createSqliteHelpers } from '../../../src/retrieval/sqlite-helpers.js';
import { rankBM25, rankBM25Fields } from '../../../src/retrieval/rankers.js';

const databases = [], statements = [];
let rejectBroadLengths = false, returnedPostings = 0;
const makeDb = total => {
  const db = new Database(':memory:'); databases.push(db); db.exec(CREATE_TABLES_BASE_SQL);
  const vocab = db.prepare('INSERT INTO token_vocab VALUES(?,?,?)');
  vocab.run('code', 10, 'alpha'); vocab.run('code', 20, 'beta');
  const post = db.prepare('INSERT INTO token_postings VALUES(?,?,?,?)'), length = db.prepare('INSERT INTO doc_lengths VALUES(?,?,?)');
  let lengthSum = 0;
  db.transaction(() => {
    for (let row = 0; row < total; row++) {
      const id = row * 2, len = 1 + row % 9; lengthSum += len;
      length.run('code', id, len); post.run('code', 10, id, 1 + row % 4);
      if (row % 7 === 0) post.run('code', 20, id, 1);
    }
  })();
  db.prepare('INSERT INTO token_stats VALUES(?,?,?)').run('code', lengthSum / total, total);
  const prepare = db.prepare.bind(db);
  db.prepare = sql => {
    if (rejectBroadLengths && /^SELECT doc_id, len FROM doc_lengths/.test(sql)) assert.fail('cold selective hydration cannot fetch all document lengths');
    const statement = prepare(sql);
    if (/FROM token_postings/.test(sql)) {
      statement.all = () => assert.fail('posting rows must stream directly into their one retained representation');
      const iterate = statement.iterate.bind(statement);
      statement.iterate = function* (...params) {
        statements.push({ sql, params });
        for (const record of iterate(...params)) {
          if (!/COUNT\(\*\)/.test(sql)) returnedPostings++;
          yield record;
        }
      };
    }
    return statement;
  };
  return { db, prepare };
};
let active = makeDb(900);
const helperOptions = { getDb: () => active.db, postingsConfig: { enablePhraseNgrams: false, enableChargrams: false } };
const broadHelpers = createSqliteHelpers(helperOptions);
const tokens = ['alpha', 'alpha', 'beta', 'absent'];
const idx = { chunkMeta: Array.from({ length: 1800 }, (_, id) => id % 2 ? null : { weight: id === 1798 ? 20 : 1 }) };
try {
  const broad = broadHelpers.getTokenIndexForQuery(tokens, 'code');
  const all = rankBM25({ idx, tokens, topN: 900, tokenIndexOverride: broad });
  rejectBroadLengths = true;
  const helpers = createSqliteHelpers(helperOptions);
  for (const eligible of [new Set([14]), new Set([0, 14, 1798]), new Set()]) {
    returnedPostings = 0;
    const cost = {}, selected = helpers.getTokenIndexForQuery(tokens, 'code', { allowedIds: eligible, metrics: cost });
    assert.equal(cost.plan, 'indexed-eligible-id-probes');
    assert.equal(selected.documentFrequencies[selected.vocabIndex.get('alpha')], 900,
      'global DF remains global even when a single document is admitted');
    assert.equal(selected.docLengths instanceof Map, true);
    assert.ok(selected.docLengths.size <= eligible.size);
    assert.ok(returnedPostings <= eligible.size * 2);
    const expected = all.filter(hit => eligible.has(hit.idx));
    const actual = rankBM25({ idx, tokens, topN: 900, tokenIndexOverride: selected, allowedIdx: eligible });
    assert.deepEqual(actual, expected, 'a score cannot change when unrelated candidates are filtered');
    assert.deepEqual(rankBM25Fields({ idx, tokens, topN: 900, tokenIndexOverride: selected, allowedIdx: eligible,
      fieldWeights: { body: 1 } }), expected, 'body alias uses the same global DF and selectively loaded lengths');
  }
  const query = statements.find(record => /LEFT JOIN doc_lengths/.test(record.sql));
  const plan = active.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).all(...query.params);
  assert.ok(plan.some(row => /SEARCH p USING PRIMARY KEY.*mode=.*token_id=.*doc_id=/.test(row.detail)),
    'the actual schema supports indexed eligible-ID probes through the existing composite primary key');
  rejectBroadLengths = false;
  const broadCost = {};
  helpers.getTokenIndexForQuery(tokens, 'code', { allowedIds: new Set(Array.from({ length: 900 }, (_, id) => id * 2)), metrics: broadCost });
  assert.equal(broadCost.plan, 'broad-streamed-postings', 'large domains retain the broad path');
  active = makeDb(2);
  const replacement = helpers.getTokenIndexForQuery(['alpha'], 'code', { allowedIds: new Set([0]) });
  assert.equal(replacement.totalDocs, 2, 'database-handle replacement cannot reuse prior-generation corpus statistics');
  assert.equal(replacement.documentFrequencies[0], 2);
  assert.throws(() => rankBM25({ idx, tokens: ['alpha'], topN: 1,
    tokenIndexOverride: { ...replacement, documentFrequencies: [0] } }), /Invalid global BM25/);
  console.log('Selective SQLite BM25 streams admitted postings/lengths while preserving global statistics and exact scores.');
} finally { for (const db of databases) db.close(); }
