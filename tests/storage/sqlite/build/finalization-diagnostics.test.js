#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { closeSqliteBuildDatabase } from '../../../../src/storage/sqlite/build/core.js';
import { buildDatabaseFromBundles } from '../../../../src/storage/sqlite/build/from-bundles.js';
import { buildDatabaseFromArtifacts } from '../../../../src/storage/sqlite/build/from-artifacts/build.js';
import { prepareIsolatedTestCacheDir } from '../../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('sqlite-finalization-diagnostics');
const diagnosticError = new Error('diagnostic callback failure');
const checkpointError = new Error('checkpoint failure');
const makeHandle = () => {
  const calls = { checkpoints: 0, restores: 0, closes: 0 };
  const db = {
    pragma(sql) {
      if (sql.startsWith('wal_checkpoint(')) {
        calls.checkpoints += 1;
        throw checkpointError;
      }
      calls.restores += 1;
      throw new Error('pragma restoration failure');
    },
    close() { calls.closes += 1; }
  };
  return { db, calls };
};

try {
  const checkpoint = makeHandle();
  let warnings = 0;
  await closeSqliteBuildDatabase({
    db: checkpoint.db,
    succeeded: true,
    outPath: path.join(dir, 'checkpoint.db'),
    warn(error) {
      warnings += 1;
      assert.equal(error, checkpointError);
      throw diagnosticError;
    }
  });
  assert.deepEqual(checkpoint.calls, { checkpoints: 1, restores: 0, closes: 1 });
  assert.equal(warnings, 1, 'still attempt the diagnostic callback');

  const restore = makeHandle();
  const originalWarn = console.warn;
  let restoreWarnings = 0;
  console.warn = () => { restoreWarnings += 1; throw diagnosticError; };
  try {
    await closeSqliteBuildDatabase({
      db: restore.db,
      succeeded: true,
      pragmaState: { before: { locking_mode: 'normal' } },
      outPath: path.join(dir, 'restore.db')
    });
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(restore.calls.closes, 1, 'close despite pragma warning callback failure');
  assert.equal(restore.calls.restores, 3, 'attempt all configured/fallback pragma restoration');
  assert.equal(restoreWarnings, 3);

  const promotion = makeHandle();
  let promotionError = null;
  await assert.rejects(closeSqliteBuildDatabase({
    db: promotion.db,
    succeeded: true,
    outPath: path.join(dir, 'published.db'),
    dbPath: path.join(dir, 'missing-build.db'),
    promotePath: path.join(dir, 'published.db'),
    warn(error) {
      if (error !== checkpointError) promotionError = error;
      throw diagnosticError;
    }
  }), (error) => error === promotionError && error.code === 'ERR_TEMP_MISSING');
  assert.equal(promotion.calls.closes, 1, 'close before attempted promotion');

  const failed = makeHandle();
  const failedPath = path.join(dir, 'failed.db');
  await Promise.all(['', '-wal', '-shm'].map((suffix) => fs.writeFile(`${failedPath}${suffix}`, 'failed')));
  await closeSqliteBuildDatabase({
    db: failed.db,
    succeeded: false,
    outPath: failedPath,
    warn() { throw diagnosticError; }
  });
  assert.deepEqual(failed.calls, { checkpoints: 0, restores: 0, closes: 1 });
  for (const suffix of ['', '-wal', '-shm']) {
    await assert.rejects(fs.access(`${failedPath}${suffix}`), { code: 'ENOENT' });
  }

  const handles = [];
  const closeCounts = new Map();
  const buildError = new Error('primary artifact build failure');
  let failCheckpoint = false;
  let failIndexes = false;
  function TrackingDatabase(file) {
    const db = new Database(file);
    handles.push(db);
    const pragma = db.pragma.bind(db);
    const exec = db.exec.bind(db);
    const close = db.close.bind(db);
    db.pragma = (sql, ...args) => {
      if (failCheckpoint && sql.startsWith('wal_checkpoint(')) throw checkpointError;
      return pragma(sql, ...args);
    };
    db.exec = (sql, ...args) => {
      if (failIndexes && sql.includes('CREATE INDEX idx_chunks_file_id')) throw buildError;
      return exec(sql, ...args);
    };
    db.close = () => {
      closeCounts.set(db, (closeCounts.get(db) || 0) + 1);
      close();
    };
    return db;
  }
  try {
    const chunk = { id: 0, file: 'sample.js', start: 0, end: 1, tokens: [] };
    await fs.writeFile(path.join(dir, 'bundle.json'), JSON.stringify({ chunks: [chunk] }));
    failCheckpoint = true;
    let nativeWarnings = 0;
    const bundlePath = path.join(dir, 'bundle.db');
    const bundleResult = await buildDatabaseFromBundles({
      Database: TrackingDatabase,
      outPath: bundlePath,
      mode: 'code',
      incrementalData: {
        manifest: { files: { 'sample.js': { bundles: ['bundle.json'], hash: 'sample' } } },
        bundleDir: dir
      },
      envConfig: { bundleThreads: 1 },
      threadLimits: { fileConcurrency: 1 },
      emitOutput: true,
      validateMode: 'off',
      vectorConfig: { enabled: false },
      modelConfig: { id: null },
      buildPragmas: false,
      optimize: false,
      logger: {
        log() {},
        warn() { nativeWarnings += 1; throw diagnosticError; }
      }
    });
    assert.equal(bundleResult.count, 1);
    assert.equal(nativeWarnings, 1, 'reach the real bundle close-checkpoint warning');
    assert.equal(closeCounts.get(handles[0]), 1);
    assert.equal(handles[0].open, false, 'no real bundle database leak');
    const reader = new Database(bundlePath, { readonly: true });
    try {
      assert.equal(reader.prepare('SELECT COUNT(*) AS count FROM chunks').get().count, 1);
    } finally {
      reader.close();
    }

    failCheckpoint = false;
    const indexDir = path.join(dir, 'artifacts');
    await fs.mkdir(indexDir);
    for (const primaryFailure of [false, true]) {
      failIndexes = primaryFailure;
      let clampWarnings = 0;
      const artifactPath = path.join(dir, `artifacts-${primaryFailure}.db`);
      const run = () => buildDatabaseFromArtifacts({
        Database: TrackingDatabase,
        outPath: artifactPath,
        indexDir,
        index: {
          chunkMeta: [{ ...chunk }],
          tokenPostings: { vocab: [], postings: [], docLengths: [0], avgDocLen: 0, totalDocs: 1 },
          // Hand-authored storage bytes only: no embedding/model work occurs.
          denseVec: { dims: 2, vectors: [[-1, 256]], model: 'synthetic-storage-fixture' }
        },
        mode: 'code',
        emitOutput: true,
        validateMode: 'off',
        vectorConfig: { enabled: false },
        modelConfig: { id: null },
        buildPragmas: false,
        optimize: false,
        logger: {
          log() {},
          warn(message) {
            if (message.includes('Uint8 vector values clamped')) {
              clampWarnings += 1;
              throw diagnosticError;
            }
          }
        }
      });
      if (primaryFailure) {
        await assert.rejects(run, (error) => error === buildError, 'preserve the primary build failure');
        await assert.rejects(fs.access(artifactPath), { code: 'ENOENT' });
      } else {
        assert.equal(await run(), 1);
      }
      assert.equal(clampWarnings, 1, 'reach the real artifact finalization warning');
      const handle = handles.at(-1);
      assert.equal(closeCounts.get(handle), 1);
      assert.equal(handle.open, false, 'no real artifact database leak');
    }
  } finally {
    for (const handle of handles) {
      if (handle.open) Database.prototype.close.call(handle);
    }
  }
} finally {
  await fs.rm(dir, { recursive: true, force: true });
}

console.log('sqlite finalization diagnostic ownership test passed');
