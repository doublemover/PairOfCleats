import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_LOG_HISTORY_LIMIT = 50;
const DEFAULT_LOG_CLOSE_TIMEOUT_MS = 5000;

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
 *   closeRepoLog:() => Promise<void>,
 *   closeMasterLog:() => Promise<void>,
 *   closeLogsSync:() => void,
 *   appendLog:(line:string,level?:'info'|'warn'|'error',meta?:object|null) => void,
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
  let masterLogStream = null;
  let repoLogStream = null;
  let repoLogPath = null;
  const logsRoot = path.dirname(masterLogPath);
  const logHistory = [];

  const isWritableOpen = (stream) => Boolean(
    stream
    && typeof stream.write === 'function'
    && !stream.destroyed
    && !stream.writableEnded
  );

  /**
   * Close a writable stream and await close event with bounded timeout.
   *
   * @param {import('node:stream').Writable|null} stream
   * @param {string} label
   * @returns {Promise<void>}
   */
  const closeStream = async (stream, label) => {
    if (!stream || stream.destroyed || stream.closed) return;
    await new Promise((resolve) => {
      let settled = false;
      let timeout = null;
      const finalize = () => {
        if (settled) return;
        settled = true;
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        try { stream.off?.('close', onClose); } catch {}
        try { stream.off?.('error', onError); } catch {}
        resolve();
      };
      const onClose = () => finalize();
      const onError = () => finalize();
      try { stream.once('close', onClose); } catch {}
      try { stream.once('error', onError); } catch {}
      timeout = setTimeout(() => {
        try { stream.destroy(); } catch {}
        finalize();
      }, DEFAULT_LOG_CLOSE_TIMEOUT_MS);
      try {
        if (!stream.writableEnded) {
          stream.end();
        } else if (stream.destroyed || stream.closed) {
          finalize();
        }
      } catch {
        try { stream.destroy(); } catch {}
        finalize();
      }
    });
  };

  /**
   * Force-close a writable stream synchronously for process-exit fallback.
   *
   * @param {import('node:stream').Writable|null} stream
   * @returns {void}
   */
  const closeStreamSync = (stream) => {
    if (!stream) return;
    try {
      if (!stream.writableEnded && !stream.destroyed) {
        stream.end();
      }
    } catch {}
    try { stream.destroy(); } catch {}
  };

  const initMasterLog = () => {
    if (masterLogStream) return;
    fs.mkdirSync(logsRoot, { recursive: true });
    masterLogStream = fs.createWriteStream(masterLogPath, { flags: 'a' });
    masterLogStream.write(`\n=== Bench run ${new Date().toISOString()} ===\n`);
    masterLogStream.write(`Config: ${configPath}\n`);
    masterLogStream.write(`Repos: ${reposRoot}\n`);
    masterLogStream.write(`Cache: ${cacheRoot}\n`);
    masterLogStream.write(`Results: ${resultsRoot}\n`);
    if (repoLogsEnabled) {
      masterLogStream.write(`Repo logs: ${logsRoot}\n`);
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
    repoLogStream = fs.createWriteStream(repoLogPath, { flags: 'a' });
    repoLogStream.write(`\n=== Bench run ${new Date().toISOString()} ===\n`);
    repoLogStream.write(`Target: ${label}${tier ? ` tier=${tier}` : ''}\n`);
    repoLogStream.write(`Repo path: ${repoDir}\n`);
    repoLogStream.write(`Config: ${configPath}\n`);
    repoLogStream.write(`Cache: ${cacheRoot}\n`);
    repoLogStream.write(`Results: ${resultsRoot}\n`);
    repoLogStream.write(`Master log: ${masterLogPath}\n`);
    initMasterLog();
    masterLogStream?.write(`[log] Repo log for ${label}: ${repoLogPath}\n`);
    return repoLogPath;
  };

  const closeRepoLog = async () => {
    const stream = repoLogStream;
    repoLogStream = null;
    repoLogPath = null;
    await closeStream(stream, 'bench-repo-log');
  };

  const closeMasterLog = async () => {
    const stream = masterLogStream;
    masterLogStream = null;
    await closeStream(stream, 'bench-master-log');
  };

  const closeLogsSync = () => {
    const repoStream = repoLogStream;
    const masterStream = masterLogStream;
    repoLogStream = null;
    repoLogPath = null;
    masterLogStream = null;
    closeStreamSync(repoStream);
    closeStreamSync(masterStream);
  };

  const appendToLogFileSync = (filePath, line) => {
    if (!filePath) return;
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.appendFileSync(filePath, `${line}\n`);
    } catch {}
  };

  const writeLog = (line) => {
    if (!masterLogStream) initMasterLog();
    if (isWritableOpen(masterLogStream)) {
      try { masterLogStream.write(`${line}\n`); } catch {}
    }
    if (isWritableOpen(repoLogStream)) {
      try { repoLogStream.write(`${line}\n`); } catch {}
    }
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
    if (level === 'error') {
      display.error(line, meta);
    } else if (level === 'warn') {
      display.warn(line, meta);
    } else if (meta && typeof meta === 'object' && meta.kind === 'status') {
      display.logLine(line, meta);
    } else {
      display.log(line, meta);
    }
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
    closeRepoLog,
    closeMasterLog,
    closeLogsSync,
    appendLog,
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
