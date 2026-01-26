#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeBundleFile } from '../../../../src/shared/bundle-io.js';
import { incrementalUpdateDatabase } from '../../../../src/storage/sqlite/build/incremental-update.js';
import { CREATE_TABLES_BASE_SQL, SCHEMA_VERSION } from '../../../../src/storage/sqlite/schema.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const tempRoot = path.join(ROOT, '.testCache', 'sqlite-ann-existing-table');
const bundleDir = path.join(tempRoot, 'bundles');
const dbPath = path.join(tempRoot, 'index-code.db');

let Database;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch {
  console.error('better-sqlite3 is required for sqlite incremental tests.');
  process.exit(1);
}

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(bundleDir, { recursive: true });

const db = new Database(dbPath);
db.exec(CREATE_TABLES_BASE_SQL);
db.exec('CREATE TABLE dense_vectors_ann (rowid INTEGER PRIMARY KEY, embedding BLOB)');
db.pragma(`user_version = ${SCHEMA_VERSION}`);
const insertManifest = db.prepare(
  'INSERT INTO file_manifest (mode, file, hash, mtimeMs, size, chunk_count) VALUES (?, ?, ?, ?, ?, ?)'
);
insertManifest.run('code', 'sample.txt', 'old-hash', 120, 5, 0);
insertManifest.run('code', 'keep-1.txt', 'keep-1', 120, 1, 0);
insertManifest.run('code', 'keep-2.txt', 'keep-2', 120, 1, 0);
insertManifest.run('code', 'keep-3.txt', 'keep-3', 120, 1, 0);
db.close();

const bundleName = 'bundle.json';
const bundlePath = path.join(bundleDir, bundleName);
await writeBundleFile({
  bundlePath,
  format: 'json',
  bundle: {
    chunks: [
      {
        file: 'sample.txt',
        start: 0,
        end: 5,
        tokens: ['hello'],
        embedding: [0.1, 0.2]
      }
    ]
  }
});

const manifest = {
  files: {
    'sample.txt': {
      bundle: bundleName,
      mtimeMs: 123,
      size: 5,
      hash: 'abc'
    },
    'keep-1.txt': { bundle: bundleName, mtimeMs: 120, size: 1, hash: 'keep-1' },
    'keep-2.txt': { bundle: bundleName, mtimeMs: 120, size: 1, hash: 'keep-2' },
    'keep-3.txt': { bundle: bundleName, mtimeMs: 120, size: 1, hash: 'keep-3' }
  }
};

const result = await incrementalUpdateDatabase({
  Database,
  outPath: dbPath,
  mode: 'code',
  incrementalData: { manifest, bundleDir },
  modelConfig: { id: null },
  vectorConfig: {
    enabled: true,
    extension: { table: 'dense_vectors_ann', column: 'embedding' },
    encodeVector: () => Buffer.from([1, 2]),
    loadVectorExtension: () => ({ ok: true }),
    hasVectorTable: () => true,
    ensureVectorTable: () => ({ ok: true, tableName: 'dense_vectors_ann', column: 'embedding' })
  },
  emitOutput: false,
  validateMode: 'off',
  expectedDense: null
});

if (!result.used || result.insertedChunks !== 1) {
  console.error(`Expected incremental update to insert 1 chunk, got: ${JSON.stringify(result)}`);
  process.exit(1);
}

const dbAfter = new Database(dbPath, { readonly: true });
const annRow = dbAfter.prepare('SELECT COUNT(*) AS count FROM dense_vectors_ann').get();
dbAfter.close();

if (!Number.isFinite(annRow?.count) || annRow.count !== 1) {
  console.error(`Expected ANN table rows to be 1, got ${annRow?.count}`);
  process.exit(1);
}

console.log('SQLite incremental ANN insert with existing table ok.');

