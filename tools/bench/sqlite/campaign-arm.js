import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { buildDatabaseFromBundles } from '../../../src/storage/sqlite/build/from-bundles.js';
import { incrementalUpdateDatabase } from '../../../src/storage/sqlite/build/incremental-update.js';
import { resolveSqliteIngestPlan } from '../../../src/storage/sqlite/utils.js';
import { createSqliteCacheCloseOwner } from '../../../src/retrieval/sqlite-cache-close-owner.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';
import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';
import { createSqliteBenchInputCache, prepareSqliteBenchValidation, validateSqliteBenchDatabase } from './validate.js';
import { requireSqliteDb } from './shared.js';

const common = { envConfig: { bundleThreads: 1 }, threadLimits: { fileConcurrency: 1 }, emitOutput: false,
  validateMode: 'off', vectorConfig: { enabled: false }, modelConfig: { id: null } };
const fileBytes = async file => { try { return (await fs.stat(file)).size; } catch (error) { if (error.code === 'ENOENT') return 0; throw error; } };

const withNative = async (Database, filename, operation) => {
  const db = new Database(filename, { readonly: true, fileMustExist: true });
  let active = false, failed = false, primary;
  const native = createSqliteCacheCloseOwner(db, { canClose: () => !active, onClosed() {} });
  try { active = true; return await operation(db); }
  catch (error) { failed = true; primary = error; native.retainFailure(error); throw error; }
  finally {
    active = false;
    try { native.retire(); }
    catch (cleanup) { if (failed) throw addStorageFailureContext(primary, {}, cleanup, { secondaryPresent: true }); throw cleanup; }
  }
};

/** Native backup is outside operation timing. Both update arms receive an
 * independent database, then validate its complete initial source facts. */
export const copySqliteBenchSeed = (Database, source, destination) => withNative(Database, source, async db => {
  const backup = db.backup;
  if (typeof backup !== 'function') throw new TypeError('Original SQLite native backup owner is unavailable.');
  const result = await backup.call(db, destination);
  observeStorageResource(result, { phase: 'sqlite-benchmark-native-backup' }).requireSettled();
  assert.equal(result.remainingPages, 0); assert.ok(Number.isSafeInteger(result.totalPages) && result.totalPages > 0);
  return result;
});

const probeRuntime = (Database, filename) => withNative(Database, filename, db => {
  const pageSize = Number(db.pragma('page_size', { simple: true })), journalMode = db.pragma('journal_mode', { simple: true });
  assert.ok(Number.isSafeInteger(pageSize) && pageSize >= 512); assert.equal(typeof journalMode, 'string');
  return { pageSize, journalMode: journalMode.toLowerCase() };
});

/** The original contiguous native operation and complete validation for one
 * arm. Function-only seed/trial coordinates serve explicit qualification; the
 * public benchmark continues to build its own initial database per arm. */
export const runSqliteBenchmarkArm = async ({ Database, operation, label, trial, order, sqliteMode = 'code',
  bundleDir, outPath, workload, seedPath = null, inputCache = createSqliteBenchInputCache(), onProgress = async () => {}, phaseObserver = null }) => {
  if (!['build', 'update'].includes(operation) || !['baseline', 'current'].includes(label)
    || !Number.isSafeInteger(trial) || trial < 1 || trial > 12) throw new TypeError('Invalid private SQLite arm coordinate.');
  const samples = [], setups = [];
  let activeAttempt = null;
  const phase = (name, work) => phaseObserver ? phaseObserver.run(name, work) : work();
  const publish = () => onProgress({ samples, setups, activeAttempt });
  const initial = await phase('source-admission', () => prepareSqliteBenchValidation({ bundleDir, manifest: workload.initial.manifest, cache: inputCache }));
  const baseOptions = { Database, outPath, mode: sqliteMode, ...common, inputBytes: initial.bundleBytes,
    ...(phaseObserver ? { emitOutput: true, logger: { log: message => phaseObserver.progress(message), warn: message => console.warn(message) } } : {}),
    batchSize: { inputBytes: initial.bundleBytes, repoBytes: initial.bundleBytes, rowCount: initial.rows, fileCount: initial.files },
    incrementalData: { manifest: workload.initial.manifest, bundleDir } };
  if (operation === 'update') {
    activeAttempt = { trial, label, phase: seedPath ? 'initial-native-backup' : 'initial-build', dbPath: outPath,
      manifestSha256: workload.initial.manifestSha256, expectedRows: workload.initial.rows };
    await publish(); const setupAt = performance.now();
    if (seedPath) await phase('initial-native-backup', () => copySqliteBenchSeed(Database, seedPath, outPath));
    else {
      const built = await phase('initial-build', () => buildDatabaseFromBundles({ ...baseOptions, buildPragmas: true, optimize: true }));
      assert.equal(built.count, workload.initial.rows);
    }
    const buildMs = performance.now() - setupAt;
    activeAttempt.phase = 'initial-validation'; activeAttempt.buildMs = buildMs; await publish();
    const validateAt = performance.now();
    const observation = await phase('initial-validation', () => validateSqliteBenchDatabase({ Database, dbPath: outPath, bundleDir,
      manifest: workload.initial.manifest, mode: sqliteMode, expectedRows: workload.initial.rows, admission: initial }));
    setups.push({ trial, label, buildMs, validationMs: performance.now() - validateAt,
      preparation: seedPath ? 'independent-native-backup-of-closed-validated-seed' : 'fresh-native-build', observation });
    activeAttempt = null; await publish();
  }
  for (const [index, step] of (operation === 'build' ? [workload.initial] : workload.rounds).entries()) {
    const admission = await prepareSqliteBenchValidation({ bundleDir, manifest: step.manifest, cache: inputCache });
    const stats = {}, round = operation === 'build' ? 0 : index + 1;
    let adaptive = null, value;
    if (operation === 'update') {
      requireSqliteDb(outPath);
      const runtime = await probeRuntime(Database, outPath), dbBytes = await fileBytes(outPath), walBytes = await fileBytes(`${outPath}-wal`);
      const config = { ...runtime, walEnabled: runtime.journalMode === 'wal', walBytes,
        rowCount: step.insertedChunks, fileCount: step.changedFiles, inputBytes: dbBytes, repoBytes: dbBytes };
      adaptive = { config, plan: resolveSqliteIngestPlan({ batchSize: config }) };
    }
    activeAttempt = { trial, label, round, phase: operation, dbPath: outPath,
      manifestSha256: step.manifestSha256, expectedRows: step.rows, stats,
      expectedMutations: operation === 'update' ? { changedFiles: step.changedFiles, deletedFiles: step.deletedFiles, insertedChunks: step.insertedChunks } : null };
    await publish(); const began = performance.now();
    if (operation === 'build') value = await phase('bundle-build', () => buildDatabaseFromBundles({ ...baseOptions, buildPragmas: label === 'current', optimize: label === 'current', stats }));
    else value = await phase('incremental-update', () => incrementalUpdateDatabase({ ...baseOptions, incrementalData: { manifest: step.manifest, bundleDir },
      inputBytes: adaptive.plan.repoBytes, batchSize: adaptive.config, buildPragmas: label === 'current', stats }));
    const durationMs = performance.now() - began;
    activeAttempt.operationMs = durationMs; activeAttempt.phase = 'validation';
    if (operation === 'build') assert.equal(value.count, step.rows);
    else {
      assert.equal(value.used, true, `Incremental update skipped: ${value.reason || 'unknown reason'}`);
      assert.equal(value.changedFiles, step.changedFiles); assert.equal(value.deletedFiles, step.deletedFiles); assert.equal(value.insertedChunks, step.insertedChunks);
    }
    requireSqliteDb(outPath); await publish(); const validationAt = performance.now();
    const observation = await phase('database-validation', () => validateSqliteBenchDatabase({ Database, dbPath: outPath, bundleDir,
      manifest: step.manifest, mode: sqliteMode, expectedRows: step.rows, admission }));
    assert.equal(stats.tables?.chunks?.rows, operation === 'build' ? step.rows : step.insertedChunks,
      'realized native writes must equal independently requested work');
    samples.push({ trial, order, label, round, dbPath: outPath, durationMs, validationMs: performance.now() - validationAt,
      manifestSha256: step.manifestSha256, observation, stats, ...(adaptive ? { adaptive } : {}),
      mutations: operation === 'update' ? { changedFiles: value.changedFiles, deletedFiles: value.deletedFiles, insertedChunks: value.insertedChunks } : null });
    activeAttempt = null; await publish();
  }
  return { samples, setups };
};
