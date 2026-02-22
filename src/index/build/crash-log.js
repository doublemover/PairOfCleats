import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { getRecentLogEvents } from '../../shared/progress.js';
import { createTempPath } from '../../shared/json-stream/atomic.js';
import { atomicWriteJson } from '../../shared/io/atomic-write.js';
import { sha1 } from '../../shared/hash.js';
import { normalizeFailureEvent, validateFailureEvent } from './failure-taxonomy.js';

const formatTimestamp = () => new Date().toISOString();
const RENAME_RETRY_CODES = new Set(['EEXIST', 'EPERM', 'ENOTEMPTY', 'EACCES', 'EXDEV']);

const safeStringify = (value) => {
  try {
    return JSON.stringify(value);
  } catch {
    return '"[unserializable]"';
  }
};

const sanitizePathToken = (value, fallback = 'unknown') => {
  const raw = value == null ? '' : String(value);
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  const cleaned = trimmed.replace(/[^a-zA-Z0-9._-]+/g, '_');
  return cleaned || fallback;
};

const computeForensicSignature = (payload) => {
  try {
    return sha1(JSON.stringify(payload || null)).slice(0, 20);
  } catch {
    return sha1(String(payload || '')).slice(0, 20);
  }
};

const writeJsonAtomicSync = (filePath, value) => {
  const tempPath = createTempPath(filePath);
  try {
    fsSync.writeFileSync(tempPath, JSON.stringify(value, null, 2));
    try {
      fsSync.renameSync(tempPath, filePath);
    } catch (err) {
      if (!RENAME_RETRY_CODES.has(err?.code)) throw err;
      try {
        fsSync.rmSync(filePath, { force: true });
      } catch {}
      fsSync.renameSync(tempPath, filePath);
    }
  } catch (err) {
    try {
      fsSync.rmSync(tempPath, { force: true });
    } catch {}
    throw err;
  }
};

export async function createCrashLogger({ repoCacheRoot, enabled }) {
  if (!enabled || !repoCacheRoot) {
    return {
      enabled: false,
      updatePhase: () => {},
      updateFile: () => {},
      logError: () => {},
      persistForensicBundle: async () => null
    };
  }
  const logsDir = path.join(repoCacheRoot, 'logs');
  const statePath = path.join(logsDir, 'index-crash-state.json');
  const logPath = path.join(logsDir, 'index-crash.log');
  const eventsPath = path.join(logsDir, 'index-crash-events.json');
  const forensicsDir = path.join(logsDir, 'forensics');
  const forensicsIndexPath = path.join(logsDir, 'index-crash-forensics-index.json');
  const forensicSignatures = new Set();
  const forensicBundleIndex = new Map();
  let currentPhase = null;
  let currentFile = null;
  try {
    await fs.mkdir(logsDir, { recursive: true });
    await fs.appendFile(logPath, '');
  } catch {}

  const writeState = async (state) => {
    const payload = { ts: formatTimestamp(), ...state };
    try {
      await atomicWriteJson(statePath, payload, { spaces: 2 });
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
      writeJsonAtomicSync(statePath, payload);
    } catch {}
  };
  const appendLineSync = (message, extra) => {
    const suffix = extra ? ` ${safeStringify(extra)}` : '';
    const line = `[${formatTimestamp()}] ${message}${suffix}\n`;
    try {
      fsSync.appendFileSync(logPath, line);
    } catch {}
  };

  const persistForensicBundle = async ({
    kind = 'forensic',
    signature = null,
    bundle = null,
    meta = null
  } = {}) => {
    if (!bundle || typeof bundle !== 'object') return null;
    const resolvedKind = sanitizePathToken(kind, 'forensic');
    const resolvedSignature = sanitizePathToken(
      signature || bundle?.signature || computeForensicSignature({ kind: resolvedKind, bundle }),
      'bundle'
    );
    if (forensicSignatures.has(resolvedSignature)) {
      return forensicBundleIndex.get(resolvedSignature)?.path || null;
    }
    const fileName = `${resolvedKind}-${resolvedSignature}.json`;
    const filePath = path.join(forensicsDir, fileName);
    const payload = {
      ts: formatTimestamp(),
      kind: resolvedKind,
      signature: resolvedSignature,
      phase: currentPhase || null,
      file: currentFile?.file || null,
      meta: meta || null,
      bundle
    };
    try {
      await fs.mkdir(forensicsDir, { recursive: true });
      await atomicWriteJson(filePath, payload, { spaces: 2 });
      forensicSignatures.add(resolvedSignature);
      forensicBundleIndex.set(resolvedSignature, {
        ts: payload.ts,
        kind: resolvedKind,
        signature: resolvedSignature,
        path: filePath
      });
      await atomicWriteJson(
        forensicsIndexPath,
        {
          ts: formatTimestamp(),
          entries: Array.from(forensicBundleIndex.values())
            .sort((a, b) => String(a.signature).localeCompare(String(b.signature)))
        },
        { spaces: 2 }
      );
      await appendLine(`forensic bundle persisted (${resolvedKind})`, {
        signature: resolvedSignature,
        path: filePath
      });
      return filePath;
    } catch {
      return null;
    }
  };

  void appendLine('crash-logger initialized', { path: logPath }).catch(() => {});

  return {
    enabled: true,
    updatePhase(phase) {
      currentPhase = phase || null;
      void writeState({ phase }).catch(() => {});
      void appendLine(`phase ${phase}`).catch(() => {});
    },
    updateFile(entry) {
      currentFile = entry || null;
      void writeState({ phase: entry?.phase || 'file', file: entry || null }).catch(() => {});
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
          writeJsonAtomicSync(eventsPath, { ts: formatTimestamp(), events: recentEvents });
        } catch {}
      }
    },
    persistForensicBundle
  };
}
