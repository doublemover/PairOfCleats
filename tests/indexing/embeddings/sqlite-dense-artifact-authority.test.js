#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runSqliteDenseIsolateChild } from '../../../tools/build/embeddings/sqlite-dense-isolate.js';
import { SCHEMA_VERSION } from '../../../src/storage/sqlite/schema.js';
import { writeSqliteIndexFormat } from '../../../src/storage/sqlite/index-format.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-dense-authority-'));
const dbPath = path.join(root, 'index.db'), vectorsPath = path.join(root, 'vectors');
const db = new Database(dbPath);
db.exec('CREATE TABLE dense_vectors(mode TEXT,doc_id INTEGER,vector BLOB); CREATE TABLE dense_meta(mode TEXT,dims INTEGER,scale REAL,model TEXT)');
db.pragma(`user_version=${SCHEMA_VERSION}`); writeSqliteIndexFormat(db);
db.prepare('INSERT INTO dense_vectors VALUES (?,?,?)').run('code', 0, Buffer.from([1, 2]));
db.close();
const payload = { root, dbPath, mode: 'code', vectorsPath, dims: 2, modelId: 'fixture', scale: 1,
  userConfig: { sqlite: { use: true, vectorExtension: { enabled: false } } } };
const before = await fs.readFile(dbPath);
try {
  for (const metadata of [null, '{bad', JSON.stringify({ count: 1, dims: 2, model: 'other' }), JSON.stringify({ count: 1, dims: 2, model: 'fixture' })]) {
    if (metadata !== null) await fs.writeFile(`${vectorsPath}.meta.json`, metadata);
    await assert.rejects(runSqliteDenseIsolateChild(payload), { code: 'ERR_SQLITE_DENSE_ARTIFACT_INVALID' });
    assert.deepEqual(await fs.readFile(dbPath), before, 'unreadable isolate input cannot mutate prior SQLite bytes');
  }
  await fs.writeFile(`${vectorsPath}.meta.json`, JSON.stringify({ format: 'jsonl-sharded', totalRecords: 2, dims: 2, model: 'fixture' }));
  await fs.writeFile(`${vectorsPath}.bin.meta.json`, JSON.stringify({ count: 2, dims: 2, model: 'fixture', bytes: 4 }));
  await fs.writeFile(`${vectorsPath}.bin`, Buffer.from([1, 2, 3, 4]));
  assert.equal((await runSqliteDenseIsolateChild(payload)).count, 2,
    'producer sharded totalRecords and binary count metadata agree on authoritative rows');
  const afterValid = await fs.readFile(dbPath);
  await fs.writeFile(`${vectorsPath}.bin.meta.json`, JSON.stringify({ count: 3, dims: 2, model: 'fixture', bytes: 6 }));
  await assert.rejects(runSqliteDenseIsolateChild(payload), { code: 'ERR_SQLITE_DENSE_ARTIFACT_INVALID' });
  assert.deepEqual(await fs.readFile(dbPath), afterValid, 'disagreeing binary identity cannot mutate prior SQLite bytes');
  await fs.rm(`${vectorsPath}.bin.meta.json`);
  await assert.rejects(runSqliteDenseIsolateChild({ ...payload, dims: 3 }), { code: 'ERR_SQLITE_DENSE_ARTIFACT_INVALID' });
  await fs.writeFile(`${vectorsPath}.meta.json`, JSON.stringify({ count: 0, totalRecords: 2, dims: 2, model: 'fixture' }));
  await fs.writeFile(`${vectorsPath}.bin`, '');
  await assert.rejects(runSqliteDenseIsolateChild(payload), { code: 'ERR_SQLITE_DENSE_ARTIFACT_INVALID' });
  assert.deepEqual(await fs.readFile(dbPath), afterValid, 'conflicting source counts cannot clear prior authority');
  await fs.writeFile(`${vectorsPath}.meta.json`, JSON.stringify({ count: 0, dims: 2, model: 'fixture' }));
  await fs.writeFile(`${vectorsPath}.bin`, '');
  assert.equal((await runSqliteDenseIsolateChild(payload)).count, 0, 'validated zero-vector replacement remains supported');
  const verify = new Database(dbPath);
  try { assert.equal(verify.prepare('SELECT COUNT(*) AS n FROM dense_vectors').get().n, 0); }
  finally { verify.close(); }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('SQLite dense isolate preserves authority on artifact read failure');
