#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { CREATE_TABLES_BASE_SQL, SCHEMA_VERSION } from '../../../../src/storage/sqlite/schema.js';
import { writeSqliteIndexFormat } from '../../../../src/storage/sqlite/index-format.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../../src/contracts/versioning.js';
import { writeIncrementalBundleSnapshot } from '../../../../src/index/build/incremental/bundle-snapshot.js';
import { incrementalUpdateDatabase } from '../../../../src/storage/sqlite/build/incremental-update.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-incremental-ann-fallback-'));
const outPath = path.join(root, 'index.db');
const db = new Database(outPath);
db.exec(CREATE_TABLES_BASE_SQL); db.pragma(`user_version=${SCHEMA_VERSION}`); writeSqliteIndexFormat(db);
db.exec('CREATE TABLE dense_vectors_ann(rowid INTEGER PRIMARY KEY,embedding BLOB)');
db.prepare('INSERT INTO dense_vectors_ann VALUES(?,?)').run(1, Buffer.from([99]));
const insert = db.prepare('INSERT INTO file_manifest(mode,file,hash,mtimeMs,size,chunk_count) VALUES(?,?,?,?,?,?)');
for (const name of ['a.js', 'keep1.js', 'keep2.js', 'keep3.js']) insert.run('code', name, 'old', 1, 5, 0);
db.close();
try {
  const entry = { hash: 'new', size: 5, mtimeMs: 2 };
  const snapshot = await writeIncrementalBundleSnapshot({ bundleDir: root, relKey: 'a.js', entry,
    bundles: [{ file: 'a.js', hash: 'new', size: 5, chunks: [{ file: 'a.js', start: 0, end: 1, tokens: ['token'], embedding: [0.1, 0.2] }] }] });
  const files = { 'a.js': { ...entry, ...snapshot } };
  for (const name of ['keep1.js', 'keep2.js', 'keep3.js']) files[name] = { hash: 'old', size: 5, mtimeMs: 1, ...snapshot };
  const run = available => incrementalUpdateDatabase({ Database, outPath, mode: 'code',
    incrementalData: { bundleDir: root, manifest: { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, files } },
    modelConfig: {}, vectorConfig: { enabled: true, extension: { table: 'dense_vectors_ann', column: 'embedding' },
      loadVectorExtension: () => ({ ok: available, reason: available ? null : 'injected unavailable' }),
      hasVectorTable: () => true, encodeVector: vector => Buffer.from(new Float32Array(vector).buffer) }, validateMode: 'off' });
  const skipped = await run(false);
  assert.equal(skipped.used, false); assert.match(skipped.reason, /existing ANN table unavailable/);
  const verify = new Database(outPath);
  try {
    assert.deepEqual(verify.prepare('SELECT embedding FROM dense_vectors_ann WHERE rowid=1').get().embedding, Buffer.from([99]));
    assert.equal(verify.prepare('SELECT COUNT(*) AS n FROM chunks').get().n, 0);
    assert.equal(verify.prepare("SELECT hash FROM file_manifest WHERE file='a.js'").get().hash, 'old');
  } finally { verify.close(); }
  assert.equal((await run(true)).used, true, 'extension recovery permits one coordinated update');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('incremental SQLite refuses stale ANN/base mixtures while the extension is unavailable');
