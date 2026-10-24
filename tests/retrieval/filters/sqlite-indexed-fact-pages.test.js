#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import Database from 'better-sqlite3';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { CREATE_TABLES_SQL } from '../../../src/storage/sqlite/schema.js';
import { createInsertStatements } from '../../../src/storage/sqlite/build/statements.js';
import { rebuildSqliteFilterFacts, sealSqliteFilterFacts } from '../../../src/storage/sqlite/filter-facts.js';
import { readSqliteFilterFactPage } from '../../../src/retrieval/sqlite-filter-page.js';
import { createSqliteHelpers } from '../../../src/retrieval/sqlite-helpers.js';
import { createChunkFilterPredicate } from '../../../src/retrieval/output/filters.js';
import { META_V2_SCHEMA_VERSION } from '../../../src/index/metadata/meta-v2.js';
import { createIndexBackendLoader } from '../../../src/retrieval/cli/load-indexes/backend.js';
import { createFilterEnumeration, enumerateFilterMatches, buildFilterPagination } from '../../../src/retrieval/pipeline/filter-enumeration.js';

applyTestEnv({ testing: '1' });
const cacheDir = resolveTestCachePath(process.cwd(), 'sqlite-indexed-filter-fact-pages');
const db = new Database(':memory:');
await fs.rm(cacheDir, { recursive: true, force: true });
await fs.mkdir(cacheDir, { recursive: true });
try {
  db.exec(CREATE_TABLES_SQL);
  const emptyRow = Object.fromEntries(db.prepare('PRAGMA table_info(chunks)').all().map(row => [row.name, null]));
  const statements = createInsertStatements(db);
  const rows = [
    [0, 'src/İstanbul/one.TS', 'FunctionDeclaration', { lang: ' TypeScript ' }],
    [7, 'src/İstanbul/second.ts', 'FunctionDeclaration', { effective: { languageId: 'typescript' } }],
    [29, 'src/astral-😀/three.js', 'ClassDeclaration', { lang: 'javascript' }],
    [31, 'src/astral-😀/four.js', 'FunctionDeclaration', {}]
  ];
  for (const [id, file, kind, meta] of rows) statements.insertChunk.run({ ...emptyRow, id, chunk_id: `fact:${id}`,
    mode: 'code', file, kind, metaV2_json: JSON.stringify({ schemaVersion: META_V2_SCHEMA_VERSION,
      chunkId: `fact:${id}`, ...meta }), docmeta: '{}', tokens: '[]' });
  assert.equal(sealSqliteFilterFacts(db, 'code'), true);
  const helpers = createSqliteHelpers({ getDb: () => db, postingsConfig: {} });
  const loadOptions = { includeDense: false, includeMinhash: false, includeFilterIndex: false };
  const full = helpers.loadIndexFromSqlite('code', loadOptions);
  for (const filters of [{}, { lang: 'typescript', ext: '*.ts', type: 'FunctionDeclaration' },
    { file: 'İSTANBUL' }, { file: 'src\\astral-😀' }, { file: 'istanbul', caseFile: true },
    { lang: 'unknown' }, { type: 'function' }, { file: ['missing', 'second.ts'], type: 'FunctionDeclaration' }]) {
    const match = createChunkFilterPredicate(filters);
    const expected = full.chunkMeta.filter(row => row && match(row)).map(row => row.id);
    const actual = [];
    for (let offset = 0; offset <= expected.length; offset += 1) {
      const page = await readSqliteFilterFactPage({ db, mode: 'code', filters, offset, limit: 1, rowCount: full.chunkMeta.length });
      assert.equal(page.total, expected.length);
      actual.push(...page.ids);
    }
    assert.deepEqual(actual, expected, 'cold SQL facts and the canonical hydrated predicate must agree');
  }
  assert.ok(db.prepare(`EXPLAIN QUERY PLAN SELECT doc_id FROM chunk_filter_facts
    WHERE mode=? AND language=? ORDER BY doc_id`).all('code', 'typescript')
    .some(row => row.detail.includes('idx_filter_language_doc')), 'language enumeration uses its actual SQLite index');

  const filters = { type: 'FunctionDeclaration', ext: '.ts' };
  for (let repeat = 0; repeat < 2; repeat += 1) {
    let cursor = null;
    const ids = [];
    do {
      const enumeration = createFilterEnumeration({ cursor, cacheDir, filters, modes: ['code'], generation: { buildId: 'facts-one' } });
      const loader = createIndexBackendLoader({ rootDir: cacheDir, userConfig: {}, filterOnly: true,
        filterEnumeration: enumeration, filterTopN: 2, annActive: false, requiredArtifacts: new Set(),
        loadIndexFromSqlite: helpers.loadIndexFromSqlite, hnswConfig: {} });
      const idx = await loader.loadModeIndex({ mode: 'code', run: true, backend: 'sqlite', dir: cacheDir });
      assert.equal(idx.filterLoadCost.kind, 'sqlite-indexed-filter-page');
      assert.equal(idx.chunkMeta.filter(Boolean).length, idx.preparedFilterPage.ids.length,
        'hydrate only this page, preserving sparse ordinal address space');
      const code = await enumerateFilterMatches({ meta: idx.chunkMeta, mode: 'code', topN: 2,
        enumeration, match: createChunkFilterPredicate(filters), preparedPage: idx.preparedFilterPage,
        loadCost: idx.filterLoadCost, ensureMetadata: idx.loadFilterMetadata });
      const emitted = code.slice(0, 1); // Actual output byte trimming must not skip the second row.
      ids.push(...emitted.map(row => row.id));
      const page = buildFilterPagination(enumeration, { code: emitted });
      if (page.nextCursor) {
        assert.throws(() => createFilterEnumeration({ cursor: page.nextCursor, filters, modes: ['code'],
          generation: { buildId: 'facts-two' } }), /generation changed/);
      }
      cursor = page.nextCursor;
    } while (cursor);
    assert.deepEqual(ids, [0, 7]);
  }
  for (const filters of [{ returnType: 'boolean' }, { modifiedSinceDays: 1 }, { file: '/three/' },
    { file: '\ud800' }, { calls: 'target' }]) {
    assert.equal(await readSqliteFilterFactPage({ db, mode: 'code', filters, limit: 2, rowCount: 32 }), null,
      'unsupported residuals keep the complete predicate instead of proving a negative');
  }
  const controller = new AbortController(); controller.abort(new Error('cancel filter facts'));
  await assert.rejects(readSqliteFilterFactPage({ db, mode: 'code', limit: 2, rowCount: 32,
    signal: controller.signal }), { name: 'AbortError', code: 'ABORT_ERR' });
  db.prepare("UPDATE chunks SET file='moved.js' WHERE id=7").run();
  assert.equal(await readSqliteFilterFactPage({ db, mode: 'code', filters, limit: 2, rowCount: 32 }), null,
    'any external chunk mutation revokes the accelerator seal');
  assert.equal(sealSqliteFilterFacts(db, 'code'), false, 'missing replacement facts cannot be sealed');
  await rebuildSqliteFilterFacts(db, 'code');
  assert.deepEqual((await readSqliteFilterFactPage({ db, mode: 'code', filters: { file: 'moved' }, limit: 2, rowCount: 32 })).ids, [7]);
  db.prepare('DELETE FROM chunks WHERE id=0').run();
  assert.equal(await readSqliteFilterFactPage({ db, mode: 'code', limit: 2, rowCount: 32 }), null);
  assert.equal(sealSqliteFilterFacts(db, 'code'), true);
  assert.deepEqual((await readSqliteFilterFactPage({ db, mode: 'code', limit: 8, rowCount: 32 })).ids, [7, 29, 31]);
  statements.insertChunk.run({ ...emptyRow, id: 32, chunk_id: 'legacy:32', mode: 'code', file: 'legacy.c',
    kind: 'FunctionDeclaration', metaV2_json: null, docmeta: '{}', tokens: '[]' });
  await rebuildSqliteFilterFacts(db, 'code');
  assert.deepEqual((await readSqliteFilterFactPage({ db, mode: 'code', filters: { file: 'legacy.c' },
    limit: 2, rowCount: 33 })).ids, [32], 'nullable SQLite metadata retains canonical file-filter behavior');
  console.log('SQLite indexed filter facts preserve cold/warm predicate, pagination, sparse IDs and invalidation authority.');
} finally {
  db.close();
  await fs.rm(cacheDir, { recursive: true, force: true });
}
