import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_LOG_HISTORY_LIMIT = 50;

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
 *   initRepoLog:(input:{label:string,tier?:string,repoPath:string,slug:string}) => (string|null),
 *   closeRepoLog:() => void,
 *   closeMasterLog:() => void,
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
  const initRepoLog = ({ label, tier, repoPath: repoDir, slug }) => {
    if (!repoLogsEnabled) return null;
    try {
      if (repoLogStream) repoLogStream.end();
    } catch {}
    repoLogStream = null;
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

  const closeRepoLog = () => {
    if (!repoLogStream) return;
    try {
      repoLogStream.end();
    } catch {}
    repoLogStream = null;
    repoLogPath = null;
  };

  const closeMasterLog = () => {
    if (!masterLogStream) return;
    try {
      masterLogStream.end();
    } catch {}
    masterLogStream = null;
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
    if (masterLogStream) masterLogStream.write(`${line}\n`);
    if (repoLogStream) repoLogStream.write(`${line}\n`);
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
