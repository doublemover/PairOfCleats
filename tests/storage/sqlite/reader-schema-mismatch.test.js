#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSqliteBackend } from '../../../src/retrieval/cli-sqlite.js';
import { CREATE_TABLES_BASE_SQL, CREATE_INDEXES_SQL, SCHEMA_VERSION } from '../../../src/storage/sqlite/schema.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const tempRoot = path.join(ROOT, 'tests', '.cache', 'sqlite-reader-schema-mismatch');
const dbPath = path.join(tempRoot, 'index-code.db');

let Database;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch {
  console.error('better-sqlite3 is required for sqlite reader tests.');
  process.exit(1);
}

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });

const db = new Database(dbPath);
db.exec(CREATE_TABLES_BASE_SQL);
db.exec(CREATE_INDEXES_SQL);
db.pragma(`user_version = ${Math.max(0, SCHEMA_VERSION - 1)}`);
db.close();

let forcedError = null;
try {
  await createSqliteBackend({
    useSqlite: true,
    needsCode: true,
    needsProse: false,
    sqliteCodePath: dbPath,
    sqliteProsePath: null,
    sqliteFtsRequested: false,
    backendForcedSqlite: true,
    vectorExtension: { table: 'dense_vectors_ann' },
    vectorAnnEnabled: false,
    dbCache: null,
    sqliteStates: {}
  });
} catch (err) {
  forcedError = err;
}

if (!forcedError || !String(forcedError?.message || forcedError).includes('schema mismatch')) {
  console.error('Expected forced sqlite backend to fail closed on schema mismatch.');
  process.exit(1);
}

const fallbackResult = await createSqliteBackend({
  useSqlite: true,
  needsCode: true,
  needsProse: false,
  sqliteCodePath: dbPath,
  sqliteProsePath: null,
  sqliteFtsRequested: false,
  backendForcedSqlite: false,
  vectorExtension: { table: 'dense_vectors_ann' },
  vectorAnnEnabled: false,
  dbCache: null,
  sqliteStates: {}
});

if (fallbackResult.useSqlite || fallbackResult.dbCode) {
  console.error('Expected sqlite auto backend to fall back on schema mismatch.');
  process.exit(1);
}

console.log('SQLite reader schema mismatch fail-closed ok.');
