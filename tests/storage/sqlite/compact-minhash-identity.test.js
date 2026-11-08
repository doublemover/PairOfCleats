#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { setupSqliteBuildFixture } from './helpers/build-fixture.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { compactDatabase } from '../../../tools/build/compact-sqlite-index.js';
import { assertSqliteMinhashReceiver, writeSqliteMinhashHeader } from '../../../src/storage/sqlite/minhash.js';

const fixture = await setupSqliteBuildFixture({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
  tempLabel: 'sqlite-compact-minhash-identity', chunkCount: 3, includeRowcountArtifacts: true });
const sampling = { mode: 'sampled-minified', signatureLength: 6, sampledSignatureLength: 3, hashStride: 2 };
let expected;
const source = new fixture.Database(fixture.outPath);
try { writeSqliteMinhashHeader(source, 'code', sampling); expected = assertSqliteMinhashReceiver(source, 'code'); }
finally { source.close(); }
try {
  await compactDatabase({ dbPath: fixture.outPath, mode: 'code', vectorExtension: { enabled: false }, logger: { log() {}, warn() {} } });
  const db = new fixture.Database(fixture.outPath);
  try {
    assert.deepEqual(assertSqliteMinhashReceiver(db, 'code'), expected);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM minhash_signatures WHERE mode=?').get('code').count, 3);
    db.prepare('INSERT OR REPLACE INTO minhash_signatures(mode,doc_id,sig) VALUES (?,?,?)').run('code', 3, Buffer.from([1, 2, 3]));
    assert.deepEqual(assertSqliteMinhashReceiver(db, 'code'), expected, 'subsequent receiver append preserves identity');
  } finally { db.close(); }
} finally { await fs.rm(fixture.tempRoot, { recursive: true, force: true }); }
console.log('SQLite compaction preserves MinHash identity and sampling metadata');
