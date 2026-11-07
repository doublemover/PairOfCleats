import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import Database from 'better-sqlite3';
import { CREATE_TABLES_BASE_SQL } from '../../../src/storage/sqlite/schema.js';
import { createInsertStatements } from '../../../src/storage/sqlite/build/statements.js';
import { buildChunkRow } from '../../../src/storage/sqlite/build-helpers.js';
import { META_V2_SCHEMA_VERSION } from '../../../src/index/metadata/meta-v2.js';
import { createSqliteHelpers } from '../../../src/retrieval/sqlite-helpers.js';
import { annotateQueryAst, parseQueryInput, tokenizeQueryTerms } from '../../../src/retrieval/query-parse.js';
import { compileFtsMatchFromAst } from '../../../src/retrieval/fts-query.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const samples = [];
const sqliteVersions = new Set();
const parsed = parseQueryInput('alpha NOT gamma');
const queryAst = annotateQueryAst(parsed.ast, new Set(), {}, { enablePhraseNgrams: false });
const ftsMatch = compileFtsMatchFromAst(queryAst);
const tokens = tokenizeQueryTerms(parsed.includeTerms, new Set());
for (const count of [128, 512, 2048]) {
  const db = new Database(':memory:');
  try {
    db.exec(CREATE_TABLES_BASE_SQL);
    sqliteVersions.add(db.prepare('SELECT sqlite_version() AS version').get().version);
    const insert = createInsertStatements(db);
    const rows = Array.from({ length: count }, (_, id) => ({ id, file: `source-${id}.txt`,
      metaV2: { schemaVersion: META_V2_SCHEMA_VERSION },
      name: id % 2 === 0 ? 'alpha beta' : 'alpha gamma', weight: 1,
      tokens: ['alpha', id % 2 === 0 ? 'beta' : 'gamma'],
      phraseTokens: ['alpha', id % 2 === 0 ? 'beta' : 'gamma'] }));
    db.transaction(() => {
      for (const row of rows) {
        const value = buildChunkRow(row, 'prose', row.id);
        insert.insertChunk.run(value); insert.insertFts.run(value);
      }
    })();
    const sourceIdentity = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
    const expected = Array.from({ length: 16 }, (_, index) => index * 2);
    const helpers = createSqliteHelpers({ getDb: () => db, postingsConfig: {},
      sqliteFtsWeights: [0, 1, 1, 1, 1, 1, 1, 1] });
    const load = () => helpers.loadIndexFromSqlite('prose', {
      includeChunks: false, includeDense: false, includeMinhash: false, includeFilterIndex: false
    });
    const query = (idx, budget, chunkSize) => {
      let observation;
      const started = performance.now();
      const hits = helpers.rankSqliteFts(idx, tokens, 'prose', 16, false, null, {
        queryAst, ftsMatch, overfetchRowCap: count + 1,
        overfetchTimeBudgetMs: budget, overfetchChunkSize: chunkSize,
        onOverfetch: value => { observation = value; }
      });
      const totalElapsedMs = performance.now() - started;
      assert.ok(observation);
      const ids = hits.map(hit => hit.idx);
      assert.deepEqual(ids, expected.slice(0, ids.length), 'every admitted result retains independent native eligibility and tie order');
      assert.equal(observation.hardDeadline, false);
      assert.equal(observation.nativeInterruption, false);
      for (const phase of Object.values(observation.phases)) assert.ok(Number.isFinite(phase) && phase >= 0);
      if (observation.termination === 'complete') assert.deepEqual(ids, expected);
      else assert.equal(observation.termination, 'deadline');
      return { totalElapsedMs, ids, ...observation };
    };
    for (const chunkSize of [1, 32]) {
      const positive = query(load(), 1000, chunkSize);
      assert.equal(positive.termination, 'complete', 'qualify the positive result before collecting bounded samples');
      for (const budget of [1, 5, 1000]) for (const temperature of ['cold-metadata', 'warm-metadata']) {
        const warm = temperature === 'warm-metadata' ? load() : null;
        if (warm) assert.deepEqual(query(warm, 1000, chunkSize).ids, expected);
        for (let trial = 0; trial < 3; trial++) {
          const preparationStarted = performance.now();
          const idx = warm || load();
          const helperPreparationMs = performance.now() - preparationStarted;
          const before = process.cpuUsage();
          const sample = query(idx, budget, chunkSize);
          samples.push({ count, sourceIdentity, temperature, trial,
            helperPreparationMs, cpu: process.cpuUsage(before), ...sample });
        }
      }
    }
  } finally { db.close(); }
}
assert.equal(samples.length, 108);
console.log(JSON.stringify({ kind: 'serial-real-sqlite-fts-phase-timing', node: process.version,
  sqliteVersions: [...sqliteVersions],
  scope: 'in-memory native FTS; cold/warm helper metadata, not cold operating-system pages; synchronous SQLite units remain non-interruptible',
  samples }));
