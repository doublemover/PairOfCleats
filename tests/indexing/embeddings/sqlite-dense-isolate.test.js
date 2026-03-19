#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeDenseVectorArtifacts } from '../../../src/shared/dense-vector-artifacts.js';
import { createCrashLogger } from '../../../src/index/build/crash-log.js';
import { runSqliteDenseWithBoundary } from '../../../tools/build/embeddings/sqlite-dense-isolate.js';
import { ensureTestingEnv, withTemporaryEnv } from '../../helpers/test-env.js';
import { skip } from '../../helpers/skip.js';

let Database;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch {
  skip('better-sqlite3 not available; skipping sqlite dense isolate test.');
}

ensureTestingEnv(process.env);

const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-sqlite-dense-isolate-'));
const repoCacheRoot = path.join(tempRoot, 'repo-cache');
const dbPath = path.join(tempRoot, 'index-code.db');
const vectorsBasePath = path.join(tempRoot, 'dense_vectors_uint8');

const createDbWithTables = (target) => {
  const db = new Database(target);
  db.exec('CREATE TABLE dense_vectors (mode TEXT, doc_id INTEGER, vector BLOB)');
  db.exec('CREATE TABLE dense_meta (mode TEXT, dims INTEGER, scale REAL, model TEXT, min_val REAL, max_val REAL, levels INTEGER)');
  db.close();
};

await fsPromises.mkdir(repoCacheRoot, { recursive: true });
createDbWithTables(dbPath);

const vectors = [
  [1, 2, 3],
  [4, 5, 6]
];

await writeDenseVectorArtifacts({
  indexDir: tempRoot,
  baseName: 'dense_vectors_uint8',
  vectorFields: {
    version: 1,
    generatedAt: new Date().toISOString(),
    model: 'model-a',
    dims: 3,
    count: vectors.length
  },
  vectors,
  writeBinary: true
});

const crashLogger = await createCrashLogger({
  repoCacheRoot,
  enabled: true
});

try {
  const success = await runSqliteDenseWithBoundary({
    root: tempRoot,
    userConfig: { sqlite: { use: true, vectorExtension: { enabled: false } } },
    indexRoot: tempRoot,
    repoCacheRoot,
    mode: 'code',
    vectorsPath: vectorsBasePath,
    dims: 3,
    scale: 1,
    modelId: 'model-a',
    quantization: { minVal: -1, maxVal: 1, levels: 256 },
    dbPath,
    sharedDb: false,
    writeBatchSize: 64,
    emitOutput: false,
    warnOnMissing: false,
    crashLogger,
    buildId: 'build-success',
    workerIdentity: 'stage3-sqlite:code'
  });
  assert.equal(success.skipped, false, 'expected isolate success path to update sqlite dense rows');
  assert.equal(success.count, vectors.length, 'expected isolate success path to preserve vector count');

  const verifyDb = new Database(dbPath, { readonly: true });
  const writtenRows = verifyDb.prepare('SELECT COUNT(*) AS total FROM dense_vectors WHERE mode = ?').get('code').total;
  verifyDb.close();
  assert.equal(writtenRows, vectors.length, 'expected isolate success path to write dense rows');

  let crashError = null;
  await withTemporaryEnv({
    PAIROFCLEATS_TESTING: '1',
    PAIROFCLEATS_TEST_CONFIG: JSON.stringify({
      indexing: {
        embeddings: {
          sqliteDense: {
            isolateCrashExitCode: 3221225477
          }
        }
      }
    })
  }, async () => {
    try {
      await runSqliteDenseWithBoundary({
        root: tempRoot,
        userConfig: { sqlite: { use: true, vectorExtension: { enabled: false } } },
        indexRoot: tempRoot,
        repoCacheRoot,
        mode: 'code',
        vectorsPath: vectorsBasePath,
        dims: 3,
        scale: 1,
        modelId: 'model-a',
        quantization: { minVal: -1, maxVal: 1, levels: 256 },
        dbPath,
        sharedDb: false,
        writeBatchSize: 64,
        emitOutput: false,
        warnOnMissing: false,
        crashLogger,
        buildId: 'build-crash',
        workerIdentity: 'stage3-sqlite:code',
        enableWindowsCrashCapture: true
      });
    } catch (err) {
      crashError = err;
    }
  });

  assert.ok(crashError, 'expected sqlite dense isolate crash to throw');
  assert.equal(crashError.code, 'ERR_SQLITE_STAGE3_NATIVE_CRASH', 'expected native crash code');
  assert.equal(crashError.failureClass, 'native_subprocess_crash', 'expected native crash failure class');
  assert.equal(crashError.workerId, 'stage3-sqlite:code', 'expected worker identity on crash error');
  assert.ok(crashError.replayBundlePath, 'expected replay bundle path on crash');

  const replayEnvelope = JSON.parse(await fsPromises.readFile(crashError.replayBundlePath, 'utf8'));
  assert.equal(replayEnvelope.kind, 'sqlite-stage3-replay', 'expected sqlite replay forensic bundle kind');
  assert.equal(replayEnvelope.bundle.failureClass, 'native_subprocess_crash', 'expected replay bundle failure class');
  assert.equal(replayEnvelope.bundle.replay.vectorsPath, vectorsBasePath, 'expected replay bundle vectors path');
  assert.equal(replayEnvelope.bundle.workerIdentity, 'stage3-sqlite:code', 'expected replay bundle worker identity');

  const forensicsIndexPath = path.join(repoCacheRoot, 'logs', 'index-crash-forensics-index.json');
  const forensicsIndex = JSON.parse(await fsPromises.readFile(forensicsIndexPath, 'utf8'));
  assert.equal(
    Array.isArray(forensicsIndex?.entries) && forensicsIndex.entries.some((entry) => entry.kind === 'sqlite-stage3-replay'),
    true,
    'expected sqlite replay bundle in crash forensics index'
  );
} finally {
  await crashLogger.close?.();
}

console.log('sqlite dense isolate test passed');
