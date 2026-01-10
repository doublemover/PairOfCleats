import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { getRecentLogEvents } from '../../shared/progress.js';
import { normalizeFailureEvent, validateFailureEvent } from './failure-taxonomy.js';

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
  const eventsPath = path.join(logsDir, 'index-crash-events.json');
  let currentPhase = null;
  let currentFile = null;
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
  const writeStateSync = (state) => {
    const payload = { ts: formatTimestamp(), ...state };
    try {
      fsSync.writeFileSync(statePath, JSON.stringify(payload, null, 2));
    } catch {}
  };
  const appendLineSync = (message, extra) => {
    const suffix = extra ? ` ${safeStringify(extra)}` : '';
    const line = `[${formatTimestamp()}] ${message}${suffix}\n`;
    try {
      fsSync.appendFileSync(logPath, line);
    } catch {}
  };

  if (log) log(`Crash logging enabled: ${logPath}`);

  return {
    enabled: true,
    updatePhase(phase) {
      currentPhase = phase || null;
      void writeState({ phase });
      void appendLine(`phase ${phase}`);
    },
    updateFile(entry) {
      currentFile = entry || null;
      void writeState({ phase: entry?.phase || 'file', file: entry || null });
    },
    logError(error) {
      const baseEvent = normalizeFailureEvent({
        phase: error?.phase || currentPhase,
        file: error?.file || currentFile?.file || null,
        stage: error?.stage || null,
        ...error
      });
      const validation = validateFailureEvent(baseEvent);
      const event = validation.ok
        ? baseEvent
        : { ...baseEvent, validationErrors: validation.errors };
      const recentEvents = getRecentLogEvents();
      appendLineSync('error', event || {});
      writeStateSync({ phase: 'error', error: event || null });
      if (recentEvents.length) {
        try {
          fsSync.writeFileSync(
            eventsPath,
            JSON.stringify({ ts: formatTimestamp(), events: recentEvents }, null, 2)
          );
        } catch {}
      }
    }
  };
}
