import { runCommand } from '../../shared/cli-utils.js';
import { spawnSubprocess } from '../../../src/shared/subprocess.js';
import { parseProgressEventLine } from '../../../src/shared/cli/progress-events.js';
import { normalizeEol } from '../../../src/shared/eol.js';

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

  const clearActiveChild = (child) => {
    if (activeChild === child) {
      activeChild = null;
      activeLabel = '';
    }
  };

  const killProcessTree = (pid) => {
    if (!Number.isFinite(pid)) return;
    try {
      if (process.platform === 'win32') {
        runCommand('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
        return;
      }
      process.kill(pid, 'SIGTERM');
    } catch {}
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
    if (paths.length === 1) {
      const only = paths[0];
      appendLog(`Log: ${only}`);
      appendLog(only);
      writeLog(`${prefix} Log: ${only}`);
      writeLog(`${prefix} ${only}`);
      return;
    }
    const joined = paths.join(' ');
    appendLog(`Logs: ${joined}`);
    paths.forEach((entry) => appendLog(entry));
    writeLog(`${prefix} Logs: ${joined}`);
    paths.forEach((entry) => writeLog(`${prefix} ${entry}`));
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
    const carry = { stdout: '', stderr: '' };
    const handleLine = (line) => {
      const event = parseProgressEventLine(line);
      if (event && typeof onProgressEvent === 'function') {
        onProgressEvent(event);
        return;
      }
      appendLog(line);
    };
    const handleChunk = (chunk, key) => {
      const text = carry[key] + chunk.toString('utf8');
      const normalized = normalizeEol(text);
      const parts = normalized.split('\n');
      carry[key] = parts.pop() || '';
      for (const line of parts) handleLine(line);
    };
    try {
      const result = await spawnSubprocess(cmd, args, {
        ...spawnOptions,
        onSpawn: (child) => setActiveChild(child, label),
        onStdout: (chunk) => handleChunk(chunk, 'stdout'),
        onStderr: (chunk) => handleChunk(chunk, 'stderr')
      });
      if (carry.stdout) handleLine(carry.stdout);
      if (carry.stderr) handleLine(carry.stderr);
      const code = result.exitCode;
      writeLog(`[finish] ${label} code=${code}`);
      clearActiveChild({ pid: result.pid });
      if (code === 0) {
        return { ok: true };
      }
      appendLog(`Failed: ${label}`);
      writeLog(`[error] Failed: ${label}`);
      emitLogPaths('[error]');
      if (logHistory.length) {
        appendLog('Last log lines:');
        logHistory.slice(-10).forEach((line) => appendLog(`- ${line}`));
        logHistory.slice(-10).forEach((line) => writeLog(`[error] ${line}`));   
      }
      if (logHistory.some((line) => line.toLowerCase().includes('filename too long'))) {
        appendLog('Hint: On Windows, enable long paths and set `git config --global core.longpaths true` or use a shorter --root path.');
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
      clearActiveChild({ pid: err?.result?.pid ?? null });
      appendLog(`Failed: ${label}`);
      emitLogPaths('[error]');
      if (logHistory.length) {
        appendLog('Last log lines:');
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
