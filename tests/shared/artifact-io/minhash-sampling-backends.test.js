#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { Packr } from 'msgpackr';
import { SimpleMinHash, minifyMinhashSignature, resolveMinhashSampledPlan } from '../../../src/index/minhash.js';
import { rankMinhash } from '../../../src/retrieval/rankers.js';
import { loadMinhashSignatures, loadMinhashSignatureRows } from '../../../src/shared/artifact-io/loaders/minhash.js';
import { computePackedChecksum } from '../../../src/shared/artifact-io/checksum.js';
import { writeJsonObjectFile } from '../../../src/shared/json-stream/json-writers.js';
import { packMinhashSignatures } from '../../../src/index/build/artifacts/minhash-packed.js';
import { CREATE_TABLES_BASE_SQL, SCHEMA_VERSION } from '../../../src/storage/sqlite/schema.js';
import { createVectorIngestor } from '../../../src/storage/sqlite/build/from-artifacts/vector-ingest.js';
import { packUint32 } from '../../../src/storage/sqlite/vector.js';
import { createSqliteHelpers } from '../../../src/retrieval/sqlite-helpers.js';
import { loadLmdbMinhashArtifact } from '../../../src/storage/lmdb/minhash.js';
import { LMDB_ARTIFACT_KEYS, LMDB_META_KEYS } from '../../../src/storage/lmdb/schema.js';
import { createLmdbHelpers } from '../../../src/retrieval/lmdb-helpers.js';
import { writePiecesManifest } from '../../helpers/artifact-io-fixture.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-minhash-sampling-'));
const words = ['alpha', 'beta'];
const hash = new SimpleMinHash();
for (const word of words) hash.update(word);
const fullSignature = [...hash.hashValues];
const sampling = resolveMinhashSampledPlan({ totalDocs: 5000, maxDocs: 1000, signatureLength: 128 });
const signatures = Array.from({ length: 4 }, () => minifyMinhashSignature(fullSignature, sampling));
const chunkMeta = signatures.map((_, id) => ({ id, file: `src/${id}.js` }));
const packr = new Packr();
let nativeLmdb = null;
try {
  nativeLmdb = await import('lmdb');
} catch (error) {
  if (error?.code !== 'ERR_MODULE_NOT_FOUND' || !error.message.includes("'lmdb'")) throw error;
}
let liveLmdbChecked = false;
const sqliteHelpers = (db) => createSqliteHelpers({ getDb: () => db, postingsConfig: {} });
const sqliteOptions = { includeChunks: false, includeDense: false, includeFilterIndex: false };
const initializeSqlite = (db) => {
  db.exec(CREATE_TABLES_BASE_SQL);
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
  const insert = db.prepare('INSERT INTO chunks (id, mode, file) VALUES (?, ?, ?)');
  for (const chunk of chunkMeta) insert.run(chunk.id, 'code', chunk.file);
};
const ingestor = (db) => createVectorIngestor({
  db,
  resolvedBatchSize: 2,
  insertMinhash: db.prepare('INSERT OR REPLACE INTO minhash_signatures (mode, doc_id, sig) VALUES (?, ?, ?)'),
  validationStats: { minhash: 0 },
  recordBatch: () => {},
  recordTable: () => {}
});
const assertSelf = (minhash) => assert.equal(rankMinhash({ minhash }, words, 1, new Set([0]))[0]?.sim, 1);

try {
  for (const format of ['json', 'packed']) {
    const dir = path.join(root, format);
    await fs.mkdir(dir);
    let packedMeta = null;
    if (format === 'json') {
      await writeJsonObjectFile(path.join(dir, 'minhash_signatures.json'), {
        fields: { sampling }, arrays: { signatures }
      });
      await writePiecesManifest(dir, [{ name: 'minhash_signatures', path: 'minhash_signatures.json', format }]);
    } else {
      const packed = packMinhashSignatures({ signatures });
      packedMeta = {
        format: 'u32', endian: 'le', dims: packed.dims, count: packed.count,
        checksum: computePackedChecksum(packed.buffer).hash, sampling
      };
      await fs.writeFile(path.join(dir, 'minhash_signatures.packed.bin'), packed.buffer);
      await writeJsonObjectFile(path.join(dir, 'minhash_signatures.packed.meta.json'), { fields: packedMeta });
      await writePiecesManifest(dir, [
        { name: 'minhash_signatures', path: 'minhash_signatures.packed.bin', format },
        { name: 'minhash_signatures_meta', path: 'minhash_signatures.packed.meta.json', format: 'json' }
      ]);
    }
    const loaded = await loadMinhashSignatures(dir, { strict: false });
    assert.equal(loaded.sampling.hashStride, sampling.hashStride);
    assert.ok(Object.isFrozen(loaded.sampling));
    assertSelf(loaded);
    const rows = [];
    for await (const row of loadMinhashSignatureRows(dir, { strict: false, batchSize: 2, materialize: true })) rows.push(row);
    assert.equal(rows.length, signatures.length);
    assert.ok(rows.every((row) => row.sampling === rows[0].sampling));
    assert.deepEqual(rows.map((row) => Array.from(row.sig)), signatures);

    const db = new Database(':memory:');
    try {
      initializeSqlite(db);
      const vectors = ingestor(db);
      db.exec('BEGIN');
      await vectors.ingestMinhash(loadMinhashSignatureRows(dir, { strict: false, batchSize: 2, materialize: true }), 'code');
      db.exec('COMMIT');
      const loadedSqlite = sqliteHelpers(db).loadIndexFromSqlite('code', sqliteOptions);
      assert.equal(loadedSqlite.minhash.sampling.hashStride, sampling.hashStride);
      assertSelf(loadedSqlite.minhash);
      // Existing full-width bundle updates coexist with retained sampled rows.
      db.prepare('UPDATE minhash_signatures SET sig = ? WHERE mode = ? AND doc_id = 0').run(packUint32(fullSignature), 'code');
      assertSelf(sqliteHelpers(db).loadIndexFromSqlite('code', sqliteOptions).minhash);
      await vectors.ingestMinhash({ signatures: [fullSignature] }, 'prose');
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM minhash_meta WHERE mode = ?').get('prose').n, 0);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM minhash_meta WHERE mode = ?').get('code').n, 1);

      // Conflicting metadata must be rolled back by the build's owning transaction.
      db.exec('BEGIN');
      await assert.rejects(vectors.ingestMinhash((async function* () {
        yield { docId: 10, sig: signatures[0], sampling };
        yield { docId: 11, sig: signatures[1], sampling };
        yield { docId: 12, sig: signatures[2], sampling: { ...sampling, hashStride: 2 } };
      })(), 'code'), /Conflicting minhash/);
      db.exec('ROLLBACK');
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM minhash_signatures WHERE doc_id >= 10').get().n, 0);
    } finally {
      db.close();
    }

    const lmdbPayload = await loadLmdbMinhashArtifact(dir);
    assert.ok(lmdbPayload.signatures.every(Array.isArray), 'existing codec must retain numeric values rather than uint32 byte truncation');
    const values = new Map([
      [LMDB_META_KEYS.chunkCount, packr.pack(chunkMeta.length)],
      [LMDB_ARTIFACT_KEYS.chunkMeta, packr.pack(chunkMeta)],
      [LMDB_ARTIFACT_KEYS.minhashSignatures, packr.pack(lmdbPayload)]
    ]);
    const assertLmdb = (store) => {
      const loadedLmdb = createLmdbHelpers({ getDb: () => store, hnswConfig: { enabled: false } })
        .loadIndexFromLmdb('code', { includeDense: false, includeFilterIndex: false, includeHnsw: false });
      assert.deepEqual(loadedLmdb.minhash.signatures, signatures);
      assert.equal(loadedLmdb.minhash.sampling.hashStride, sampling.hashStride);
      assertSelf(loadedLmdb.minhash);
    };
    assertLmdb({ get: (key) => values.get(key) });
    if (nativeLmdb) {
      const store = nativeLmdb.open({ path: path.join(root, `lmdb-${format}`), mapSize: 1024 * 1024, compression: false });
      try {
        for (const [key, value] of values) store.putSync(key, value);
        assertLmdb(store);
        liveLmdbChecked = true;
      } finally {
        await store.close();
      }
    }

    if (packedMeta) {
      const metaPath = path.join(dir, 'minhash_signatures.packed.meta.json');
      for (const badSampling of [{ ...sampling, mode: 'unknown' }, { ...sampling, sampledSignatureLength: 1 }]) {
        await writeJsonObjectFile(metaPath, { fields: { ...packedMeta, sampling: badSampling } });
        await assert.rejects(loadMinhashSignatures(dir, { strict: false }), { code: 'ERR_ARTIFACT_INVALID' });
      }
    }
  }

  // Existing schema-12 stores with no metadata table keep full-width behavior.
  const legacy = new Database(':memory:');
  try {
    initializeSqlite(legacy);
    legacy.exec('DROP TABLE minhash_meta');
    const insert = legacy.prepare('INSERT INTO minhash_signatures (mode, doc_id, sig) VALUES (?, ?, ?)');
    insert.run('code', 0, packUint32(fullSignature));
    insert.run('code', 1, packUint32(signatures[1]));
    const helpers = sqliteHelpers(legacy);
    const loaded = helpers.loadIndexFromSqlite('code', sqliteOptions);
    assertSelf(loaded.minhash);
    assert.deepEqual(rankMinhash(loaded, words, 1, new Set([1])), [], 'old sampled rows require metadata/rebuild, never guessed indices');
    await ingestor(legacy).ingestMinhash({ signatures, sampling }, 'code');
    assertSelf(helpers.loadIndexFromSqlite('code', sqliteOptions).minhash);
    assert.equal(legacy.pragma('user_version', { simple: true }), 12);
  } finally {
    legacy.close();
  }
  console.log(`minhash sampling backends passed: JSON/packed/stream, real SQLite, LMDB codec/helper; native LMDB ${liveLmdbChecked ? 'passed' : 'SKIPPED (optional package absent)'}`);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
