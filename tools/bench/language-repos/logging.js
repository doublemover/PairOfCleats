import fs from 'node:fs';
import path from 'node:path';
import { createQueuedAppendWriter } from '../../../src/shared/io/append-writer.js';
import { createTimeoutError, runWithTimeout } from '../../../src/shared/promise-timeout.js';

const DEFAULT_LOG_HISTORY_LIMIT = 50;
const DEFAULT_LOG_CLOSE_TIMEOUT_MS = 5000;
const DEFAULT_LOG_FLUSH_INTERVAL_MS = 2000;

/**
 * Detect disk-full diagnostics from subprocess output.
 *
 * @param {string} line
 * @returns {boolean}
 */
export const isDiskFullMessage = (line) => {
  if (!line) return false;
  const text = String(line).toLowerCase();
  return text.includes('no space left on device')
    || text.includes('disk full')
    || text.includes('database or disk is full')
    || text.includes('sqlite_full')
    || text.includes('enospc')
    || text.includes('insufficient free space');
};

/**
 * Create run-level and repo-level log sinks shared by display + file streams.
 *
 * @param {{
 *   display:object,
 *   configPath:string,
 *   reposRoot:string,
 *   cacheRoot:string,
 *   resultsRoot:string,
 *   masterLogPath:string,
 *   runSuffix:string,
 *   repoLogsEnabled:boolean,
 *   logHistoryLimit?:number
 * }} input
 * @returns {{
 *   initMasterLog:() => void,
 *   initRepoLog:(input:{label:string,tier?:string,repoPath:string,slug:string}) => Promise<(string|null)>,
 *   flushLogs:() => Promise<void>,
 *   closeRepoLog:() => Promise<void>,
 *   closeMasterLog:() => Promise<void>,
 *   closeLogsSync:() => void,
 *   appendLog:(line:string,level?:'info'|'warn'|'error',meta?:object|null) => void,
 *   appendLogSync:(line:string,level?:'info'|'warn'|'error',meta?:object|null) => void,
 *   writeListLine:(line:string) => void,
 *   writeLog:(line:string) => void,
 *   writeLogSync:(line:string) => void,
 *   clearLogHistory:() => void,
 *   hasDiskFullMessageInHistory:() => boolean,
 *   getRepoLogPath:() => (string|null),
 *   getLogPaths:() => string[],
 *   logHistory:string[]
 * }}
 */
export const createBenchLogger = ({
  display,
  configPath,
  reposRoot,
  cacheRoot,
  resultsRoot,
  masterLogPath,
  runSuffix,
  repoLogsEnabled,
  logHistoryLimit = DEFAULT_LOG_HISTORY_LIMIT
}) => {
  let masterLogWriter = null;
  let repoLogWriter = null;
  let repoLogPath = null;
  let flushTimer = null;
  const pendingSyncWrites = new Map();
  const logsRoot = path.dirname(masterLogPath);
  const logHistory = [];

  const createLogWriter = (filePath) => createQueuedAppendWriter({
    filePath,
    ensureDir: true,
    syncOnFlush: false
  });

  const trackPendingWrite = (filePath, text, promise) => {
    if (!filePath || typeof text !== 'string' || !promise?.finally) return promise;
    const pending = pendingSyncWrites.get(filePath) || [];
    pending.push(text);
    pendingSyncWrites.set(filePath, pending);
    return promise.finally(() => {
      const current = pendingSyncWrites.get(filePath);
      if (!Array.isArray(current) || !current.length) return;
      const index = current.indexOf(text);
      if (index >= 0) current.splice(index, 1);
      if (!current.length) {
        pendingSyncWrites.delete(filePath);
      } else {
        pendingSyncWrites.set(filePath, current);
      }
    });
  };

  const enqueueWriterText = (writer, filePath, text) => {
    if (!writer?.enqueue || typeof text !== 'string') return;
    void trackPendingWrite(filePath, text, writer.enqueue(text));
  };

  const clearFlushTimer = () => {
    if (!flushTimer) return;
    clearInterval(flushTimer);
    flushTimer = null;
  };

  const ensureFlushTimer = () => {
    if (flushTimer || (!masterLogWriter && !repoLogWriter)) return;
    flushTimer = setInterval(() => {
      void flushLogs();
    }, DEFAULT_LOG_FLUSH_INTERVAL_MS);
    flushTimer.unref?.();
  };

  const flushWriter = async (writer, reason) => {
    if (!writer?.flush) return;
    await runWithTimeout(
      () => writer.flush(),
      {
        timeoutMs: DEFAULT_LOG_CLOSE_TIMEOUT_MS,
        errorFactory: () => createTimeoutError({
          code: 'ERR_BENCH_LOG_FLUSH_TIMEOUT',
          message: `Bench log flush timed out during ${reason}.`
        })
      }
    );
  };

  const closeWriter = async (writer, reason) => {
    if (!writer?.close) return;
    await runWithTimeout(
      () => writer.close(),
      {
        timeoutMs: DEFAULT_LOG_CLOSE_TIMEOUT_MS,
        errorFactory: () => createTimeoutError({
          code: 'ERR_BENCH_LOG_CLOSE_TIMEOUT',
          message: `Bench log close timed out during ${reason}.`
        })
      }
    );
  };

  const initMasterLog = () => {
    if (masterLogWriter) return;
    fs.mkdirSync(logsRoot, { recursive: true });
    masterLogWriter = createLogWriter(masterLogPath);
    ensureFlushTimer();
    enqueueWriterText(masterLogWriter, masterLogPath, `\n=== Bench run ${new Date().toISOString()} ===\n`);
    enqueueWriterText(masterLogWriter, masterLogPath, `Config: ${configPath}\n`);
    enqueueWriterText(masterLogWriter, masterLogPath, `Repos: ${reposRoot}\n`);
    enqueueWriterText(masterLogWriter, masterLogPath, `Cache: ${cacheRoot}\n`);
    enqueueWriterText(masterLogWriter, masterLogPath, `Results: ${resultsRoot}\n`);
    if (repoLogsEnabled) {
      enqueueWriterText(masterLogWriter, masterLogPath, `Repo logs: ${logsRoot}\n`);
    }
  };

  /**
   * Rotate and initialize per-repo logs so each benchmark target gets an
   * isolated file while still forwarding all lines to the run master log.
   *
   * @param {{label:string,tier?:string,repoPath:string,slug:string}} input
   * @returns {string|null}
   */
  const initRepoLog = async ({ label, tier, repoPath: repoDir, slug }) => {
    if (!repoLogsEnabled) return null;
    await closeRepoLog();
    repoLogPath = path.join(logsRoot, `${runSuffix}-${slug}.log`);
    fs.mkdirSync(path.dirname(repoLogPath), { recursive: true });
    repoLogWriter = createLogWriter(repoLogPath);
    ensureFlushTimer();
    const headerLines = [
      `\n=== Bench run ${new Date().toISOString()} ===\n`,
      `Target: ${label}${tier ? ` tier=${tier}` : ''}\n`,
      `Repo path: ${repoDir}\n`,
      `Config: ${configPath}\n`,
      `Cache: ${cacheRoot}\n`,
      `Results: ${resultsRoot}\n`,
      `Master log: ${masterLogPath}\n`
    ];
    for (const line of headerLines) {
      await trackPendingWrite(repoLogPath, line, repoLogWriter.enqueue(line));
    }
    initMasterLog();
    if (masterLogWriter) {
      await trackPendingWrite(masterLogPath, `[log] Repo log for ${label}: ${repoLogPath}\n`, masterLogWriter.enqueue(`[log] Repo log for ${label}: ${repoLogPath}\n`));
    }
    return repoLogPath;
  };

  const handleLogOpSettled = (results, { reason = 'log-op', fatal = false } = {}) => {
    const failures = Array.isArray(results)
      ? results.filter((entry) => entry?.status === 'rejected').map((entry) => entry.reason)
      : [];
    if (!failures.length) return;
    const message = `[log] ${reason} failed for ${failures.length} writer(s): ${failures.map((error) => error?.message || error).join('; ')}`;
    logHistory.push(message);
    while (logHistory.length > logHistoryLimit) logHistory.shift();
    try {
      display?.warn?.(message);
    } catch {}
    if (fatal) {
      throw new AggregateError(failures, message);
    }
  };

  const flushLogs = async () => {
    const results = await Promise.allSettled([
      flushWriter(masterLogWriter, 'periodic-master'),
      flushWriter(repoLogWriter, 'periodic-repo')
    ]);
    handleLogOpSettled(results, { reason: 'periodic flush', fatal: false });
  };

  const closeRepoLog = async () => {
    const writer = repoLogWriter;
    repoLogWriter = null;
    repoLogPath = null;
    if (!writer) return;
    const flushResults = await Promise.allSettled([
      flushWriter(writer, 'repo-rotate')
    ]);
    handleLogOpSettled(flushResults, { reason: 'repo log flush', fatal: true });
    const closeResults = await Promise.allSettled([
      closeWriter(writer, 'repo-rotate')
    ]);
    handleLogOpSettled(closeResults, { reason: 'repo log close', fatal: true });
    if (!repoLogWriter && !masterLogWriter) clearFlushTimer();
  };

  const closeMasterLog = async () => {
    const writer = masterLogWriter;
    masterLogWriter = null;
    if (!writer) return;
    const flushResults = await Promise.allSettled([
      flushWriter(writer, 'master-close')
    ]);
    handleLogOpSettled(flushResults, { reason: 'master log flush', fatal: true });
    const closeResults = await Promise.allSettled([
      closeWriter(writer, 'master-close')
    ]);
    handleLogOpSettled(closeResults, { reason: 'master log close', fatal: true });
    if (!repoLogWriter && !masterLogWriter) clearFlushTimer();
  };

  const closeLogsSync = () => {
    clearFlushTimer();
    for (const [filePath, pending] of pendingSyncWrites.entries()) {
      if (!Array.isArray(pending) || !pending.length) continue;
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.appendFileSync(filePath, pending.join(''));
      } catch {}
    }
    pendingSyncWrites.clear();
    repoLogWriter = null;
    repoLogPath = null;
    masterLogWriter = null;
  };

  const appendToLogFileSync = (filePath, line) => {
    if (!filePath) return;
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.appendFileSync(filePath, `${line}\n`);
    } catch {}
  };

  const emitToDisplay = (line, level, meta) => {
    if (level === 'error') {
      display.error(line, meta);
    } else if (level === 'warn') {
      display.warn(line, meta);
    } else if (meta && typeof meta === 'object' && meta.kind === 'status') {
      display.logLine(line, meta);
    } else {
      display.log(line, meta);
    }
  };

  const writeLog = (line) => {
    if (!masterLogWriter) initMasterLog();
    if (masterLogWriter) enqueueWriterText(masterLogWriter, masterLogPath, `${line}\n`);
    if (repoLogWriter && repoLogPath) enqueueWriterText(repoLogWriter, repoLogPath, `${line}\n`);
  };

  const writeLogSync = (line) => {
    appendToLogFileSync(masterLogPath, line);
    if (repoLogPath && repoLogPath !== masterLogPath) {
      appendToLogFileSync(repoLogPath, line);
    }
  };

  /**
   * Unified display + file log sink.
   *
   * @param {string} line
   * @param {'info'|'warn'|'error'} [level]
   * @param {object|null} [meta]
   * @returns {void}
   */
  const appendLog = (line, level = 'info', meta = null) => {
    if (!line) return;
    const fileOnlyLine = meta && typeof meta === 'object' && typeof meta.fileOnlyLine === 'string'
      ? meta.fileOnlyLine
      : null;
    writeLog(fileOnlyLine || line);
    emitToDisplay(line, level, meta);
    logHistory.push(line);
    if (logHistory.length > logHistoryLimit) logHistory.shift();
  };

  const appendLogSync = (line, level = 'info', meta = null) => {
    if (!line) return;
    const fileOnlyLine = meta && typeof meta === 'object' && typeof meta.fileOnlyLine === 'string'
      ? meta.fileOnlyLine
      : null;
    writeLogSync(fileOnlyLine || line);
    emitToDisplay(line, level, meta);
    logHistory.push(line);
    if (logHistory.length > logHistoryLimit) logHistory.shift();
  };

  const writeListLine = (line) => {
    appendLog(line, 'info', { forceOutput: true });
  };

  const clearLogHistory = () => {
    logHistory.length = 0;
  };

  const hasDiskFullMessageInHistory = () => logHistory.some((line) => isDiskFullMessage(line));
  const getRepoLogPath = () => repoLogPath;
  const getLogPaths = () => {
    const paths = [masterLogPath];
    if (repoLogPath && repoLogPath !== masterLogPath) paths.push(repoLogPath);
    return paths;
  };

  return {
    initMasterLog,
    initRepoLog,
    flushLogs,
    closeRepoLog,
    closeMasterLog,
    closeLogsSync,
    appendLog,
    appendLogSync,
    writeListLine,
    writeLog,
    writeLogSync,
    clearLogHistory,
    hasDiskFullMessageInHistory,
    getRepoLogPath,
    getLogPaths,
    logHistory
  };
};
