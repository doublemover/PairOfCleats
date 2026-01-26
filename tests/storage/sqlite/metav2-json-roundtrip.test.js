#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createSqliteHelpers } from '../../../src/retrieval/sqlite-helpers.js';
import { normalizePostingsConfig } from '../../../src/shared/postings-config.js';
import { CREATE_TABLES_BASE_SQL, SCHEMA_VERSION } from '../../../src/storage/sqlite/schema.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'sqlite-metav2-roundtrip');
const dbPath = path.join(tempRoot, 'index-code.db');

let Database;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch {
  console.error('better-sqlite3 is required for sqlite metadata tests.');
  process.exit(1);
}

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const metaV2 = {
  chunkId: 'chunk_1',
  file: 'src/a.js',
  range: { start: 0, end: 1, startLine: 1, endLine: 1 },
  lang: 'javascript',
  ext: '.js'
};

const db = new Database(dbPath);
db.exec(CREATE_TABLES_BASE_SQL);
db.pragma(`user_version = ${SCHEMA_VERSION}`);
db.prepare(
  'INSERT INTO chunks (id, chunk_id, mode, file, start, end, startLine, endLine, ext, metaV2_json) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
).run(
  0,
  metaV2.chunkId,
  'code',
  metaV2.file,
  metaV2.range.start,
  metaV2.range.end,
  metaV2.range.startLine,
  metaV2.range.endLine,
  metaV2.ext,
  JSON.stringify(metaV2)
);
db.close();

const readDb = new Database(dbPath, { readonly: true });
const postingsConfig = normalizePostingsConfig({});
const vectorAnnState = {
  code: { available: false },
  prose: { available: false },
  records: { available: false },
  'extracted-prose': { available: false }
};
const helpers = createSqliteHelpers({
  getDb: () => readDb,
  postingsConfig,
  sqliteFtsWeights: [1, 1, 1, 1],
  vectorExtension: {},
  vectorAnnState,
  queryVectorAnn: () => [],
  modelIdDefault: null,
  fileChargramN: postingsConfig.chargramMinN
});

const { chunkMeta } = helpers.loadIndexFromSqlite('code', {
  includeMinhash: false,
  includeDense: false,
  includeFilterIndex: false
});
readDb.close();

assert.equal(chunkMeta.length, 1);
assert.deepStrictEqual(chunkMeta[0].metaV2, metaV2);

console.log('sqlite metaV2_json roundtrip ok');
