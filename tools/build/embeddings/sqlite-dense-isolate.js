import path from 'node:path';
import { getTestEnvConfig } from '../../../src/shared/env/testing.js';
import { sha1 } from '../../../src/shared/hash.js';
import { runIsolatedNodeScriptSync } from '../../../src/shared/subprocess/runner.js';
import { updateSqliteDense } from './sqlite-dense.js';
import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';
import { isWindowsCdbCollector, runWindowsCdbCollector, getWindowsCdbFailureResult } from '../../shared/windows-cdb-collector.js';

const CHILD_ENV = 'PAIROFCLEATS_SQLITE_DENSE_CHILD';
const PAYLOAD_ENV = 'PAIROFCLEATS_SQLITE_DENSE_PAYLOAD';
const REPLAY_SCHEMA_VERSION = '1.1.0';

const WINDOWS_NATIVE_CRASH_EXIT_CODES = new Set([
  3221225477, // 0xC0000005 access violation
  3221225786, // 0xC000013A terminated
  3221226505, // 0xC0000409 fast-fail / stack buffer overrun
  -1073741819,
  -1073741510,
  -1073740791
]);

const toText = (value) => (typeof value === 'string' ? value.trim() : '');

const truncateText = (value, maxChars = 4000) => {
  const text = typeof value === 'string' ? value : '';
  if (text.length <= maxChars) return text;
  return text.slice(text.length - maxChars);
};

const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

export const isSqliteDenseNativeCrashExit = (exitCode) => {
  const code = Number(exitCode);
  if (!Number.isFinite(code)) return false;
  if (WINDOWS_NATIVE_CRASH_EXIT_CODES.has(code)) return true;
  return code < 0;
};

const resolveSqliteDenseTestConfig = () => {
  const testConfig = getTestEnvConfig();
  const sqliteDense = testConfig?.testing
    ? testConfig?.config?.indexing?.embeddings?.sqliteDense
    : null;
  return isPlainObject(sqliteDense) ? sqliteDense : null;
};

const maybeInjectSqliteDenseTestFailure = () => {
  const config = resolveSqliteDenseTestConfig();
  if (!config) return;
  const crashExitCode = Number(config.isolateCrashExitCode);
  if (Number.isFinite(crashExitCode) && crashExitCode !== 0) {
    process.exit(Math.trunc(crashExitCode));
  }
  if (config.isolateThrow === true) {
    throw new Error('Injected sqlite dense isolate failure.');
  }
};

/** A requested directory is not a dump-producing capability. Keep normal
 * replay diagnostics when no scoped native collector has been admitted. */
export const resolveSqliteDenseCrashCapture = ({ requested = false, platform = process.platform } = {}) => Object.freeze({
  requested: requested === true, enabled: false,
  status: requested !== true ? 'disabled' : platform === 'win32' ? 'unavailable' : 'unsupported-platform',
  reason: requested !== true ? null : platform === 'win32' ? 'native-dump-collector-not-configured' : 'native-dump-capture-requires-windows',
  collector: null, dumpDir: null, dumpFiles: Object.freeze([])
});
const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null;

const buildReplayBundle = ({
  buildId = null,
  workerIdentity = null,
  mode = null,
  payload = null,
  childResult = null,
  failureClass = null,
  crashCapture = null
} = {}) => ({
  schemaVersion: REPLAY_SCHEMA_VERSION,
  generatedAt: new Date().toISOString(),
  stage: 'stage3',
  operation: 'sqlite-dense',
  buildId: buildId || null,
  mode: mode || null,
  workerIdentity: workerIdentity || null,
  failureClass: failureClass || null,
  replay: {
    root: payload?.root || null,
    indexRoot: payload?.indexRoot || null,
    repoCacheRoot: payload?.repoCacheRoot || null,
    dbPath: payload?.dbPath || null,
    vectorsPath: payload?.vectorsPath || null,
    dims: finite(payload?.dims),
    scale: finite(payload?.scale),
    modelId: payload?.modelId || null,
    quantization: payload?.quantization || null,
    sharedDb: payload?.sharedDb === true,
    writeBatchSize: finite(payload?.writeBatchSize)
  },
  child: {
    exitCode: finite(childResult?.exitCode),
    signal: toText(childResult?.signal) || null,
    durationMs: finite(childResult?.durationMs),
    nativeCrash: Boolean(crashCapture?.dump) || isSqliteDenseNativeCrashExit(childResult?.exitCode),
    stdoutTail: truncateText(childResult?.stdout),
    stderrTail: truncateText(childResult?.stderr),
    stdoutStatus: typeof childResult?.stdout === 'string' ? 'captured' : 'unavailable',
    stderrStatus: typeof childResult?.stderr === 'string' ? 'captured' : 'unavailable'
  },
  crashCapture
});

export const runSqliteDenseIsolateChild = async (payload = {}) => {
  const { recordWindowsCdbChildPhase: recordPhase } = await import('../../shared/windows-cdb-child.js');
  recordPhase('sqlite:entry');
  maybeInjectSqliteDenseTestFailure();
  let Database = null;
  recordPhase('sqlite:before-native-import');
  try {
    ({ default: Database } = await import('better-sqlite3'));
  } catch (err) {
    const observation = observeStorageResource(err, { phase: 'sqlite-dense-native-import' });
    observation.requireSettled();
    let detail;
    try { detail = typeof err?.message === 'string' ? err.message : 'native import failed'; }
    catch (inspection) { throw observation.wrap(inspection); }
    throw observation.wrap(new Error(`better-sqlite3 unavailable for sqlite dense isolate: ${detail}`, { cause: err }));
  }
  recordPhase('sqlite:native-import-completed');
  recordPhase('sqlite:update-start');
  const result = await updateSqliteDense({
    Database,
    root: payload.root,
    userConfig: payload.userConfig,
    indexRoot: payload.indexRoot,
    mode: payload.mode,
    vectorsPath: payload.vectorsPath,
    dims: payload.dims,
    scale: payload.scale,
    modelId: payload.modelId,
    quantization: payload.quantization,
    dbPath: payload.dbPath,
    sharedDb: payload.sharedDb === true,
    writeBatchSize: payload.writeBatchSize,
    emitOutput: false,
    warnOnMissing: payload.warnOnMissing !== false,
    logger: console
  });
  recordPhase('sqlite:update-completed');
  return result;
};

export const runSqliteDenseWithBoundary = async ({
  root,
  userConfig,
  indexRoot,
  repoCacheRoot = null,
  mode,
  vectorsPath,
  dims,
  scale,
  modelId,
  quantization,
  dbPath = null,
  sharedDb = false,
  writeBatchSize = 256,
  emitOutput = true,
  warnOnMissing = false,
  crashLogger = null,
  buildId = null,
  workerIdentity = null,
  logger = console,
  enableWindowsCrashCapture = false,
  windowsCrashCollector = null,
  testRunChild = null
} = {}) => {
  if (!toText(vectorsPath)) {
    const error = new Error(`[embeddings] ${mode}: sqlite dense isolate requires vectorsPath.`);
    error.code = 'ERR_SQLITE_DENSE_ISOLATE_INPUT';
    throw error;
  }
  if (testRunChild !== null && (typeof testRunChild !== 'function' || !getTestEnvConfig().testing)) {
    throw Object.assign(new Error('SQLite child runner injection requires the explicit test environment.'), { code: 'ERR_SQLITE_DENSE_ISOLATE_INPUT' });
  }
  if (windowsCrashCollector !== null && (!isWindowsCdbCollector(windowsCrashCollector) || testRunChild !== null)) {
    throw Object.assign(new Error('SQLite native collection requires its original scoped collector and child runner.'), { code: 'ERR_SQLITE_DENSE_ISOLATE_INPUT' });
  }
  let crashCapture = resolveSqliteDenseCrashCapture({ requested: enableWindowsCrashCapture });
  const payload = {
    root,
    userConfig,
    indexRoot,
    repoCacheRoot,
    mode,
    vectorsPath,
    dims,
    scale,
    modelId,
    quantization,
    dbPath,
    sharedDb,
    writeBatchSize,
    emitOutput,
    warnOnMissing
  };
  const moduleUrl = new URL('./sqlite-dense-isolate.js', import.meta.url).href;
  const childPayload = {
    ...payload,
    moduleUrl
  };
  const script = `
    const payload = JSON.parse(process.env.${PAYLOAD_ENV} || '{}');
    const run = async () => {
      const mod = await import(payload.moduleUrl);
      const result = await mod.runSqliteDenseIsolateChild(payload);
      process.stdout.write(JSON.stringify(result || {}));
    };
    run().catch((err) => {
      console.error(err?.message || String(err));
      process.exit(2);
    });
  `;
  const childOptions = {
    script,
    env: {
      ...process.env,
      [CHILD_ENV]: '1',
      [PAYLOAD_ENV]: JSON.stringify(childPayload)
    },
    cwd: root || process.cwd(),
    maxOutputBytes: 1024 * 1024,
    outputMode: 'string',
    captureStdout: true,
    captureStderr: true,
    rejectOnNonZeroExit: false,
    name: `sqlite-dense:${mode || 'unknown'}`
  };
  let childResult, collectorFailure = null;
  if (windowsCrashCollector !== null) {
    try {
      const captured = await runWindowsCdbCollector(windowsCrashCollector, childOptions);
      childResult = captured.childResult; crashCapture = captured.crashCapture;
    } catch (error) {
      const observation = observeStorageResource(error, { phase: 'sqlite-dense-native-collector' });
      observation.requireSettled();
      const captured = getWindowsCdbFailureResult(error);
      if (!captured) throw error;
      collectorFailure = error; crashCapture = captured.crashCapture;
      childResult = captured.childResult || Object.freeze({ exitCode: null, signal: null, stdout: '', stderr: '', durationMs: null });
    }
  } else childResult = await (testRunChild || runIsolatedNodeScriptSync)(childOptions);
  const childObservation = observeStorageResource(childResult, { phase: 'sqlite-dense-original-child' });
  childObservation.requireSettled();
  let observed;
  try {
    const status = childResult?.exitCode;
    observed = Object.freeze({ exitCode: Number.isSafeInteger(status) ? status : null, signal: toText(childResult?.signal) || null,
      durationMs: finite(childResult?.durationMs), stdout: childResult?.stdout, stderr: childResult?.stderr,
      stdoutTruncated: childResult?.outputCapture?.stdout?.truncated === true });
  } catch (inspection) { throw childObservation.wrap(inspection); }
  childObservation.requireSettled();
  if (observed.exitCode === 0 && !observed.signal && collectorFailure === null) {
    let parsed = null;
    try {
      const text = toText(observed.stdout);
      if (!text || observed.stdoutTruncated) throw new SyntaxError('SQLite child JSON is empty or truncated.');
      parsed = JSON.parse(text);
      if (!isPlainObject(parsed)) throw new TypeError('SQLite child result must be an object.');
    } catch (err) {
      const error = new Error(`[embeddings] ${mode}: sqlite dense isolate returned invalid JSON: ${err?.message || err}`);
      error.code = 'ERR_SQLITE_DENSE_ISOLATE_PARSE';
      error.result = childResult;
      throw error;
    }
    if (emitOutput !== false && parsed?.skipped !== true && typeof logger?.log === 'function') {
      const logged = logger.log(`[embeddings] ${mode}: SQLite dense vectors updated (${dbPath || 'sqlite'}).`);
      observeStorageResource(logged, { phase: 'sqlite-dense-success-log' }).requireSettled();
    }
    childObservation.requireSettled();
    return parsed;
  }

  const nativeCrash = Boolean(crashCapture.dump) || isSqliteDenseNativeCrashExit(observed.exitCode);
  const failureClass = nativeCrash ? 'native_subprocess_crash' : 'subprocess_failure';
  const resolvedWorkerIdentity = workerIdentity || `stage3-sqlite:${mode || 'unknown'}`;
  const replayBundle = buildReplayBundle({
    buildId,
    workerIdentity: resolvedWorkerIdentity,
    mode,
    payload,
    childResult: observed,
    failureClass,
    crashCapture
  });
  const primary = Object.assign(new Error(
    `[embeddings] ${mode}: sqlite dense isolate failed (exit=${observed.exitCode ?? 'null'} signal=${observed.signal || 'null'}).`
  ), {
    code: nativeCrash ? 'ERR_SQLITE_STAGE3_NATIVE_CRASH' : 'ERR_SQLITE_STAGE3_SUBPROCESS_FAILED',
    stage: 'sqlite-dense-isolate', failureClass, workerId: resolvedWorkerIdentity, buildId: buildId || null,
    bundleId: buildId || path.basename(indexRoot || '') || null, mode: mode || null, nativeCrash,
    replayBundlePath: null, crashCapture, dumpDir: crashCapture.dumpDir, dumpFiles: crashCapture.dumpFiles, result: childResult
  });
  let failure = primary;
  if (collectorFailure !== null) failure = addStorageFailureContext(failure, {}, collectorFailure, { secondaryPresent: true, forceAggregate: true });
  try {
    if (typeof crashLogger?.persistForensicBundle === 'function') {
      const persisted = await crashLogger.persistForensicBundle({
        required: true,
        kind: 'sqlite-stage3-replay',
        signature: `sqlite-stage3-${sha1(JSON.stringify({ buildId, mode, dbPath: payload.dbPath || '',
          vectorsPath: payload.vectorsPath || '', exitCode: observed.exitCode, signal: observed.signal || '' })).slice(0, 20)}`,
        bundle: replayBundle,
        meta: { stage: 'stage3', mode, workerIdentity: resolvedWorkerIdentity }
      });
      observeStorageResource(persisted, { phase: 'sqlite-dense-forensic-publication' }).requireSettled();
      if (persisted !== null && typeof persisted !== 'string') throw new TypeError('SQLite forensic publication returned an invalid path.');
      primary.replayBundlePath = persisted;
    }
  } catch (publication) { failure = addStorageFailureContext(failure, {}, publication, { secondaryPresent: true, forceAggregate: true }); }
  try {
    if (typeof logger?.warn === 'function') {
      const logged = logger.warn(`[embeddings] ${mode}: sqlite dense isolate failed ` +
        `(exit=${observed.exitCode ?? 'null'} signal=${observed.signal || 'null'} failureClass=${failureClass}).`);
      observeStorageResource(logged, { phase: 'sqlite-dense-failure-log' }).requireSettled();
    }
  } catch (reporting) { failure = addStorageFailureContext(failure, {}, reporting, { secondaryPresent: true, forceAggregate: true }); }
  try { childObservation.requireSettled(); }
  catch (pending) { failure = addStorageFailureContext(failure, {}, pending, { secondaryPresent: true, forceAggregate: true }); }
  throw failure;
};
