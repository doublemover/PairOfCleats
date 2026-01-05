import fs from 'node:fs/promises';
import path from 'node:path';

const formatTimestamp = () => new Date().toISOString();

const safeStringify = (value) => {
  try {
    return JSON.stringify(value);
  } catch {
    return '"[unserializable]"';
  }
};

export async function createCrashLogger({ repoCacheRoot, enabled, log }) {
  if (!enabled || !repoCacheRoot) {
    return {
      enabled: false,
      updatePhase: () => {},
      updateFile: () => {},
      logError: () => {}
    };
  }
  const logsDir = path.join(repoCacheRoot, 'logs');
  const statePath = path.join(logsDir, 'index-crash-state.json');
  const logPath = path.join(logsDir, 'index-crash.log');
  try {
    await fs.mkdir(logsDir, { recursive: true });
  } catch {}

  const writeState = async (state) => {
    const payload = { ts: formatTimestamp(), ...state };
    try {
      await fs.writeFile(statePath, JSON.stringify(payload, null, 2));
    } catch {}
  };

  const appendLine = async (message, extra) => {
    const suffix = extra ? ` ${safeStringify(extra)}` : '';
    const line = `[${formatTimestamp()}] ${message}${suffix}\n`;
    try {
      await fs.appendFile(logPath, line);
    } catch {}
  };

  if (log) log(`Crash logging enabled: ${logPath}`);

  return {
    enabled: true,
    updatePhase(phase) {
      void writeState({ phase });
      void appendLine(`phase ${phase}`);
    },
    updateFile(entry) {
      void writeState({ phase: entry?.phase || 'file', file: entry || null });
    },
    logError(error) {
      void appendLine('error', error || {});
      void writeState({ phase: 'error', error: error || null });
    }
  };
}
