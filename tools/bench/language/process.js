import { spawnSubprocess } from '../../../src/shared/subprocess.js';
import { killProcessTree as killPidTree } from '../../../src/shared/kill-tree.js';
import { createProgressLineDecoder } from '../../../src/shared/cli/progress-stream.js';
import { parseProgressEventLine } from '../../../src/shared/cli/progress-events.js';
import path from 'node:path';

export const createProcessRunner = ({
  appendLog,
  writeLog,
  writeLogSync,
  logHistory,
  logPath,
  getLogPaths,
  onProgressEvent
}) => {
  let activeChild = null;
  let activeLabel = '';
  let exitLogged = false;

  const setActiveChild = (child, label) => {
    activeChild = child;
    activeLabel = label;
  };

  const clearActiveChild = (childOrPid = null) => {
    if (!activeChild) return;
    const targetPid = Number(
      typeof childOrPid === 'number'
        ? childOrPid
        : childOrPid?.pid
    );
    if (!Number.isFinite(targetPid) || Number(activeChild.pid) === targetPid || activeChild === childOrPid) {
      activeChild = null;
      activeLabel = '';
    }
  };

  const killProcessTree = (pid) => {
    if (!Number.isFinite(pid)) return;
    void killPidTree(pid, {
      killTree: true,
      detached: process.platform !== 'win32',
      graceMs: 0
    }).catch(() => {});
  };

  const logExit = (reason, code) => {
    if (exitLogged) return;
    writeLogSync(`[exit] ${reason}${Number.isFinite(code) ? ` code=${code}` : ''}`);
    exitLogged = true;
  };

  const resolveLogPaths = () => {
    try {
      if (typeof getLogPaths === 'function') {
        const resolved = getLogPaths();
        if (Array.isArray(resolved)) return resolved.filter(Boolean);
        if (typeof resolved === 'string' && resolved) return [resolved];
      }
      if (typeof logPath === 'function') {
        const resolved = logPath();
        if (typeof resolved === 'string' && resolved) return [resolved];
      }
      if (typeof logPath === 'string' && logPath) return [logPath];
    } catch {}
    return [];
  };

  const emitLogPaths = (prefix = '[error]') => {
    const paths = resolveLogPaths();
    if (!paths.length) return;
    const names = paths.map((entry) => path.basename(String(entry || ''))).filter(Boolean);
    if (paths.length === 1) {
      const only = paths[0];
      const onlyName = names[0] || 'log';
      appendLog(`[logs] ${onlyName}`, 'info', { fileOnlyLine: `Log: ${only}` });
      writeLog(`${prefix} Log: ${only}`);
      return;
    }
    const joined = paths.join(' ');
    const nameSummary = names.length ? ` (${names.join(', ')})` : '';
    appendLog(`[logs] ${paths.length} files${nameSummary}`, 'info', {
      fileOnlyLine: `Logs: ${joined}`
    });
    writeLog(`${prefix} Logs: ${joined}`);
  };

  const runProcess = async (label, cmd, args, options = {}) => {
    const { continueOnError = false, ...spawnOptionsRest } = options;
    const spawnOptions = {
      ...spawnOptionsRest,
      stdio: ['ignore', 'pipe', 'pipe'],
      rejectOnNonZeroExit: false
    };
    setActiveChild({ pid: null }, label);
    writeLog(`[start] ${label}`);
    const handleLine = (line) => {
      const event = line ? parseProgressEventLine(line, { strict: true }) : null;
      if (event && typeof onProgressEvent === 'function') {
        onProgressEvent(event);
        return;
      }
      appendLog(line);
    };
    const stdoutDecoder = createProgressLineDecoder({
      strict: true,
      onLine: ({ line }) => handleLine(line),
      onOverflow: () => writeLog('[warn] truncated oversized stdout progress line')
    });
    const stderrDecoder = createProgressLineDecoder({
      strict: true,
      onLine: ({ line }) => handleLine(line),
      onOverflow: () => writeLog('[warn] truncated oversized stderr progress line')
    });
    try {
      const result = await spawnSubprocess(cmd, args, {
        ...spawnOptions,
        onSpawn: (child) => setActiveChild(child, label),
        onStdout: (chunk) => stdoutDecoder.push(chunk),
        onStderr: (chunk) => stderrDecoder.push(chunk)
      });
      stdoutDecoder.flush();
      stderrDecoder.flush();
      const code = result.exitCode;
      writeLog(`[finish] ${label} code=${code}`);
      clearActiveChild(result.pid);
      if (code === 0) {
        return { ok: true };
      }
      appendLog(`[run] failed: ${label}`);
      writeLog(`[error] run failed: ${label}`);
      emitLogPaths('[error]');
      if (logHistory.length) {
        appendLog('[run] tail:');
        logHistory.slice(-10).forEach((line) => appendLog(`- ${line}`));
        logHistory.slice(-10).forEach((line) => writeLog(`[error] ${line}`));   
      }
      if (logHistory.some((line) => line.toLowerCase().includes('filename too long'))) {
        appendLog('[hint] Windows long paths: set `git config --global core.longpaths true` or use a shorter --root.');
        writeLog('[hint] Enable Windows long paths and set `git config --global core.longpaths true` or use a shorter --root path.');
      }
      if (!continueOnError) {
        logExit('failure', code ?? 1);
        process.exit(code ?? 1);
      }
      return { ok: false, code: code ?? 1 };
    } catch (err) {
      const message = err?.message || err;
      writeLog(`[error] ${label} spawn failed: ${message}`);
      clearActiveChild(err?.result?.pid ?? null);
      appendLog(`[run] failed: ${label}`);
      emitLogPaths('[error]');
      if (logHistory.length) {
        appendLog('[run] tail:');
        logHistory.slice(-10).forEach((line) => appendLog(`- ${line}`));
        logHistory.slice(-10).forEach((line) => writeLog(`[error] ${line}`));   
      }
      if (!continueOnError) {
        logExit('failure', err?.exitCode ?? 1);
        process.exit(err?.exitCode ?? 1);
      }
      return { ok: false, code: err?.exitCode ?? 1 };
    }
  };

  return {
    runProcess,
    killProcessTree,
    logExit,
    getActiveChild: () => activeChild,
    getActiveLabel: () => activeLabel
  };
};
