#!/usr/bin/env node
import { writeSqliteIndexFormat } from '../../../../src/storage/sqlite/index-format.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../../src/contracts/versioning.js';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeIncrementalBundleSnapshot } from '../../../../src/index/build/incremental/bundle-snapshot.js';
import { incrementalUpdateDatabase } from '../../../../src/storage/sqlite/build/incremental-update.js';
import { CREATE_TABLES_BASE_SQL, SCHEMA_VERSION } from '../../../../src/storage/sqlite/schema.js';
import { sqliteBundleIdentity } from '../../../../src/storage/sqlite/bundle-identity.js';

import { resolveTestCachePath } from '../../../helpers/test-cache.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const tempRoot = resolveTestCachePath(ROOT, 'sqlite-ann-existing-table');
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

const selectedEntry = { mtimeMs: 123, size: 5, hash: 'abc' };
const snapshot = await writeIncrementalBundleSnapshot({ bundleDir, relKey: 'sample.txt', entry: selectedEntry,
  format: 'json',
  bundles: [{ file: 'sample.txt', hash: 'abc', size: 5,
    chunks: [
      {
        file: 'sample.txt',
        start: 0,
        end: 5,
        tokens: ['hello'],
        embedding: [0.1, 0.2]
      }
    ]
  }]
});
const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
  files: {
    'sample.txt': {
      ...selectedEntry,
      ...snapshot
    }
  }
};
for (const ordinal of [1, 2, 3]) {
  const file = `keep-${ordinal}.txt`;
  const entry = { mtimeMs: 120, size: 1, hash: `keep-${ordinal}` };
  manifest.files[file] = { ...entry, ...await writeIncrementalBundleSnapshot({ bundleDir, relKey: file, entry,
    bundles: [{ file, ...entry, chunks: [] }] }) };
}
const previousEntry = { mtimeMs: 120, size: 5, hash: 'old-hash' };
const previousSnapshot = await writeIncrementalBundleSnapshot({ bundleDir, relKey: 'sample.txt', entry: previousEntry,
  bundles: [{ file: 'sample.txt', ...previousEntry, chunks: [] }] });
const db = new Database(dbPath);
try {
  db.exec(CREATE_TABLES_BASE_SQL);
  db.exec('CREATE TABLE dense_vectors_ann (rowid INTEGER PRIMARY KEY, embedding BLOB)');
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
  writeSqliteIndexFormat(db);
  const insertManifest = db.prepare(
    'INSERT INTO file_manifest (mode, file, hash, mtimeMs, size, chunk_count, bundle_hash) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  insertManifest.run('code', 'sample.txt', previousEntry.hash, previousEntry.mtimeMs, previousEntry.size, 0,
    sqliteBundleIdentity({ ...previousEntry, ...previousSnapshot }));
  for (const ordinal of [1, 2, 3]) {
    const file = `keep-${ordinal}.txt`, entry = manifest.files[file];
    insertManifest.run('code', file, entry.hash, entry.mtimeMs, entry.size, 0, sqliteBundleIdentity(entry));
  }
} finally { db.close(); }

const result = await incrementalUpdateDatabase({
  Database,
  outPath: dbPath,
  mode: 'code',
  incrementalData: { manifest, bundleDir },
  modelConfig: { id: null },
  vectorConfig: {
    enabled: true,
    extension: { table: 'dense_vectors_ann', column: 'embedding' },
    encodeVector: (vector) => Buffer.from(new Float32Array(vector).buffer),
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
