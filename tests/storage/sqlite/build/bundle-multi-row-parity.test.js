import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { buildDatabaseFromBundles } from '../../../../src/storage/sqlite/build/from-bundles.js';
import { writeIncrementalBundleSnapshot } from '../../../../src/index/build/incremental/bundle-snapshot.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../../src/contracts/versioning.js';
import { errorGraphIncludes } from '../../../helpers/error-graph.js';
import { prepareIsolatedTestCacheDir } from '../../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('sqlite-bundle-multi-row-parity');
const bundleDir = path.join(dir, 'bundles'), file = 'src/unicode café.js';
const chunks = Array.from({ length: 265 }, (_, index) => ({
  ...(index < 2 ? { id: 1000 } : {}), file, chunk_id: `owned-${index}`, start: index * 10, end: index * 10 + 9,
  startLine: index + 1, endLine: index + 1, ext: index % 2 ? '' : '.js', kind: 'function', name: `uniqueentry${index}`,
  metaV2: { chunkId: `owned-${index}`, lang: 'javascript', details: ['line\nnext', false, 0, null] },
  headline: index % 2 ? '' : 'Résumé 😀', preContext: ['before'], postContext: index % 2 ? [] : null,
  weight: index % 2 ? 0 : 0.25, tokens: ['alpha', 'alpha', 'beta', `term${index % 13}`],
  phraseTokens: index % 2 ? [] : ['alpha beta'], ngrams: ['alpha beta', 'alpha beta'], chargrams: ['alp', 'alp'],
  codeRelations: { calls: [] }, docmeta: { signature: 'call(value)', doc: 'documentation token' },
  stats: { count: 0 }, complexity: { depth: 1 }, lint: [], externalDocs: { href: 'local' },
  last_modified: index % 2 ? '' : null, last_author: 'Author', churn: 0, churn_added: 0,
  churn_deleted: index, churn_commits: 1, chunk_authors: ['A', 'B']
}));
const entry = { hash: 'selected-source-hash', size: 2650, mtimeMs: 1, dependencySignatures: {} };
let nativeRuns, nativeClosed = 0, fault = null, controller = null;
class ObservedDatabase extends Database {
  prepare(sql) {
    const statement = super.prepare(sql), table = /\bINSERT(?: OR REPLACE)? INTO (chunks(?:_fts(?:_trigram|_porter)?)?)\b/i.exec(sql)?.[1];
    if (!table) return statement;
    const run = statement.run;
    statement.run = function (...bindings) {
      nativeRuns[table] = (nativeRuns[table] || 0) + 1;
      const result = Reflect.apply(run, statement, bindings);
      if (table === 'chunks' && fault === 'reject' && nativeRuns.chunks === 2) throw originalFailure;
      if (table === 'chunks' && fault === 'abort' && nativeRuns.chunks === 1) controller.abort(originalFailure);
      return result;
    };
    return statement;
  }
  close() { super.close(); nativeClosed++; }
}
const originalFailure = Object.freeze(new Error('original bulk chunk operation failed'));
const tables = ['chunks', 'token_vocab', 'token_postings', 'doc_lengths', 'token_stats', 'phrase_vocab', 'phrase_postings',
  'chargram_vocab', 'chargram_postings', 'file_manifest', 'chunk_filter_facts', 'chunk_filter_facts_meta'];
const readDatabase = filename => {
  const db = new Database(filename, { readonly: true });
  try {
    const snapshot = Object.fromEntries(tables.map(table => [table,
      db.prepare(`SELECT * FROM ${table}`).raw().all().sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
    ]));
    const fts = {};
    for (const table of ['chunks_fts', 'chunks_fts_trigram', 'chunks_fts_porter']) {
      fts[table] = ['uniqueentry0', 'uniqueentry264', 'documentation', 'alpha', 'beta', 'Résumé'].map(query =>
        db.prepare(`SELECT rowid FROM ${table} WHERE ${table} MATCH ? ORDER BY rowid`).all(query));
      const indexedNameRows = table === 'chunks_fts_porter' ? 0 : 1;
      assert.equal(fts[table][0].length, indexedNameRows); assert.equal(fts[table][1].length, indexedNameRows);
      assert.equal(fts[table][2].length, chunks.length);
    }
    assert.equal(db.prepare('SELECT tokens FROM chunks WHERE chunk_id=?').get('owned-0').tokens,
      '["alpha","alpha","beta","term0"]');
    assert.deepEqual(db.prepare('SELECT ext,headline,weight,last_modified,phrase_tokens,postContext FROM chunks WHERE chunk_id=?').get('owned-1'),
      { ext: '', headline: '', weight: 0, last_modified: '', phrase_tokens: '[]', postContext: '[]' });
    assert.equal(db.prepare('SELECT metaV2_json FROM chunks WHERE chunk_id=?').get('owned-0').metaV2_json,
      JSON.stringify(chunks[0].metaV2));
    assert.equal(db.prepare(`SELECT p.tf FROM token_postings p JOIN token_vocab v ON v.mode=p.mode AND v.token_id=p.token_id
      WHERE p.doc_id=1000 AND v.token='alpha'`).get().tf, 2);
    assert.deepEqual(db.prepare('SELECT id FROM chunks WHERE chunk_id IN (?,?) ORDER BY start').all('owned-0', 'owned-1'),
      [{ id: 1000 }, { id: 0 }], 'explicit duplicate IDs still use the original fallback allocation order');
    return { snapshot, fts };
  } finally { db.close(); }
};
try {
  const snapshot = await writeIncrementalBundleSnapshot({ bundleDir, repoRoot: dir, relKey: file, entry,
    bundles: [chunks.slice(0, 133), chunks.slice(133)].map(shard => ({ file, ...entry, chunks: shard })) });
  const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, files: { [file]: { ...entry, ...snapshot } } };
  const build = (outPath, statementStrategy, stats) => buildDatabaseFromBundles({ Database: ObservedDatabase,
    outPath, repoRoot: dir, mode: 'code', incrementalData: { manifest, bundleDir },
    envConfig: { bundleThreads: 1 }, threadLimits: { fileConcurrency: 1 }, emitOutput: false,
    validateMode: 'full', vectorConfig: { enabled: false }, modelConfig: {}, batchSize: 128,
    ftsVariants: ['trigram', 'porter'], statementStrategy, stats, signal: controller?.signal });
  const states = [];
  for (const strategy of ['prepared', 'multi-row']) {
    nativeRuns = {}; nativeClosed = 0;
    const stats = {}, output = path.join(dir, strategy + '.db');
    assert.equal((await build(output, strategy, stats)).count, chunks.length);
    assert.equal(nativeClosed, 1);
    assert.equal(stats.transaction.begin, 1); assert.equal(stats.transaction.commit, 1); assert.equal(stats.transaction.rollback, 0);
    states.push(readDatabase(output));
    for (const table of ['chunks', 'chunks_fts', 'chunks_fts_trigram', 'chunks_fts_porter']) {
      if (strategy === 'prepared') assert.equal(nativeRuns[table], chunks.length);
      else assert(nativeRuns[table] < chunks.length / 8, `${table} must use bounded native batches rather than one call per row`);
    }
    if (strategy === 'multi-row') {
      assert.equal(stats.multiRow.chunks.rows, chunks.length);
      assert.equal(stats.multiRow.chunks_fts.rows, chunks.length);
      assert.equal(stats.multiRow.token_postings.dedupedRows, 0);
      assert.equal(stats.multiRow.token_postings.rows, chunks.length * 3);
    }
  }
  assert.deepEqual(states[1], states[0], 'all stored columns, JSON/nulls, facts, postings and FTS variants retain prepared-path meaning');
  const authorityPath = path.join(dir, 'multi-row.db'), authority = await fs.readFile(authorityPath);
  for (const selected of ['reject', 'abort']) {
    fault = selected; nativeRuns = {}; nativeClosed = 0; controller = selected === 'abort' ? new AbortController() : null;
    const stats = {};
    if (selected === 'abort') await assert.rejects(build(authorityPath, 'multi-row', stats), error => errorGraphIncludes(error, originalFailure));
    else {
      const result = await build(authorityPath, 'multi-row', stats);
      assert.equal(result.count, 0); assert.match(result.reason, /original bulk chunk operation failed/);
    }
    assert.equal(nativeClosed, 1); assert.equal(stats.transaction.commit, 0); assert.equal(stats.transaction.rollback, 1);
    assert.deepEqual(await fs.readFile(authorityPath), authority, 'a later native failure or cancellation preserves the old published database');
  }
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Bundle positional chunk/FTS batches retain complete prepared rows, native call bounds and rollback/cancellation ownership.');
