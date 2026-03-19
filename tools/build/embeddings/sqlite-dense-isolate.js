import fsSync from 'node:fs';
import path from 'node:path';
import { getTestEnvConfig } from '../../../src/shared/env.js';
import { sha1 } from '../../../src/shared/hash.js';
import { runIsolatedNodeScriptSync } from '../../../src/shared/subprocess.js';
import { updateSqliteDense } from './sqlite-dense.js';

const CHILD_ENV = 'PAIROFCLEATS_SQLITE_DENSE_CHILD';
const PAYLOAD_ENV = 'PAIROFCLEATS_SQLITE_DENSE_PAYLOAD';
const REPLAY_SCHEMA_VERSION = '1.0.0';

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
  const text = Array.isArray(value) ? value.join('\n') : String(value || '');
  if (text.length <= maxChars) return text;
  return text.slice(text.length - maxChars);
};

const sanitizePathToken = (value, fallback = 'unknown') => {
  const text = toText(value);
  if (!text) return fallback;
  const sanitized = text.replace(/[^a-zA-Z0-9._-]+/g, '_');
  return sanitized || fallback;
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

const collectFilesRecursive = (dirPath) => {
  const out = [];
  if (!dirPath || !fsSync.existsSync(dirPath)) return out;
  const stack = [path.resolve(dirPath)];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fsSync.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        out.push(fullPath);
      }
    }
  }
  return out.sort((left, right) => left.localeCompare(right));
};

const resolveCrashCaptureDir = ({
  repoCacheRoot = null,
  buildId = null,
  mode = null,
  enabled = false
} = {}) => {
  if (!enabled || !repoCacheRoot || process.platform !== 'win32') return null;
  return path.join(
    repoCacheRoot,
    'logs',
    'forensics',
    'sqlite-stage3-dumps',
    `${sanitizePathToken(buildId || mode || 'build')}-${sanitizePathToken(mode || 'mode')}`
  );
};

const buildReplayBundle = ({
  buildId = null,
  workerIdentity = null,
  mode = null,
  payload = null,
  childResult = null,
  failureClass = null,
  dumpDir = null,
  dumpFiles = []
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
    dbPath: payload?.dbPath || null,
    vectorsPath: payload?.vectorsPath || null,
    dims: Number.isFinite(Number(payload?.dims)) ? Number(payload.dims) : null,
    scale: Number.isFinite(Number(payload?.scale)) ? Number(payload.scale) : null,
    modelId: payload?.modelId || null,
    quantization: payload?.quantization || null,
    sharedDb: payload?.sharedDb === true,
    writeBatchSize: Number.isFinite(Number(payload?.writeBatchSize)) ? Number(payload.writeBatchSize) : null
  },
  child: {
    exitCode: Number.isFinite(Number(childResult?.exitCode)) ? Number(childResult.exitCode) : null,
    signal: toText(childResult?.signal) || null,
    durationMs: Number.isFinite(Number(childResult?.durationMs)) ? Number(childResult.durationMs) : null,
    nativeCrash: isSqliteDenseNativeCrashExit(childResult?.exitCode),
    stdoutTail: truncateText(childResult?.stdout),
    stderrTail: truncateText(childResult?.stderr)
  },
  crashCapture: {
    enabled: !!dumpDir,
    dumpDir: dumpDir || null,
    dumpFiles
  }
});

export const runSqliteDenseIsolateChild = async (payload = {}) => {
  maybeInjectSqliteDenseTestFailure();
  let Database = null;
  try {
    ({ default: Database } = await import('better-sqlite3'));
  } catch (err) {
    throw new Error(`better-sqlite3 unavailable for sqlite dense isolate: ${err?.message || err}`);
  }
  return updateSqliteDense({
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
  enableWindowsCrashCapture = false
} = {}) => {
  if (!toText(vectorsPath)) {
    const error = new Error(`[embeddings] ${mode}: sqlite dense isolate requires vectorsPath.`);
    error.code = 'ERR_SQLITE_DENSE_ISOLATE_INPUT';
    throw error;
  }
  const crashCaptureDir = resolveCrashCaptureDir({
    repoCacheRoot,
    buildId,
    mode,
    enabled: enableWindowsCrashCapture
  });
  const preexistingDumpFiles = new Set(collectFilesRecursive(crashCaptureDir));
  if (crashCaptureDir) {
    fsSync.mkdirSync(crashCaptureDir, { recursive: true });
  }
  const payload = {
    root,
    userConfig,
    indexRoot,
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
  const childResult = runIsolatedNodeScriptSync({
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
  });
  if (Number(childResult?.exitCode) === 0 && !toText(childResult?.signal)) {
    let parsed = null;
    try {
      parsed = JSON.parse(toText(childResult?.stdout) || '{}');
    } catch (err) {
      const error = new Error(`[embeddings] ${mode}: sqlite dense isolate returned invalid JSON: ${err?.message || err}`);
      error.code = 'ERR_SQLITE_DENSE_ISOLATE_PARSE';
      error.result = childResult;
      throw error;
    }
    if (emitOutput !== false && parsed?.skipped !== true && typeof logger?.log === 'function') {
      logger.log(`[embeddings] ${mode}: SQLite dense vectors updated (${dbPath || 'sqlite'}).`);
    }
    return parsed || { skipped: false };
  }
  const dumpFiles = collectFilesRecursive(crashCaptureDir)
    .filter((filePath) => !preexistingDumpFiles.has(filePath));
  const nativeCrash = isSqliteDenseNativeCrashExit(childResult?.exitCode);
  const failureClass = nativeCrash ? 'native_subprocess_crash' : 'subprocess_failure';
  const resolvedWorkerIdentity = workerIdentity || `stage3-sqlite:${mode || 'unknown'}`;
  const replayBundle = buildReplayBundle({
    buildId,
    workerIdentity: resolvedWorkerIdentity,
    mode,
    payload,
    childResult,
    failureClass,
    dumpDir: crashCaptureDir,
    dumpFiles
  });
  let replayBundlePath = null;
  if (typeof crashLogger?.persistForensicBundle === 'function') {
    replayBundlePath = await crashLogger.persistForensicBundle({
      kind: 'sqlite-stage3-replay',
      signature: `sqlite-stage3-${sha1(JSON.stringify({
        buildId,
        mode,
        dbPath: payload.dbPath || '',
        vectorsPath: payload.vectorsPath || '',
        exitCode: childResult?.exitCode ?? '',
        signal: childResult?.signal || ''
      })).slice(0, 20)}`,
      bundle: replayBundle,
      meta: {
        stage: 'stage3',
        mode,
        workerIdentity: resolvedWorkerIdentity
      }
    });
  }
  if (typeof logger?.warn === 'function') {
    logger.warn(
      `[embeddings] ${mode}: sqlite dense isolate failed ` +
      `(exit=${childResult?.exitCode ?? 'null'} signal=${childResult?.signal || 'null'} ` +
      `failureClass=${failureClass}).`
    );
  }
  const error = new Error(
    `[embeddings] ${mode}: sqlite dense isolate failed ` +
    `(exit=${childResult?.exitCode ?? 'null'} signal=${childResult?.signal || 'null'}).`
  );
  error.code = nativeCrash ? 'ERR_SQLITE_STAGE3_NATIVE_CRASH' : 'ERR_SQLITE_STAGE3_SUBPROCESS_FAILED';
  error.stage = 'sqlite-dense-isolate';
  error.failureClass = failureClass;
  error.workerId = resolvedWorkerIdentity;
  error.buildId = buildId || null;
  error.bundleId = buildId || path.basename(indexRoot || '') || null;
  error.mode = mode || null;
  error.nativeCrash = nativeCrash;
  error.replayBundlePath = replayBundlePath;
  error.dumpDir = crashCaptureDir;
  error.dumpFiles = dumpFiles;
  error.result = childResult;
  throw error;
};
