import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { getRecentLogEvents } from '../../shared/progress.js';
import { createTempPath } from '../../shared/json-stream/atomic.js';
import { atomicWriteJson, atomicWriteJsonSync } from '../../shared/io/atomic-write.js';
import { sha1 } from '../../shared/hash.js';
import { normalizeFailureEvent, validateFailureEvent } from './failure-taxonomy.js';

/**
 * Produce ISO-8601 timestamp for crash log entries.
 *
 * @returns {string}
 */
const formatTimestamp = () => new Date().toISOString();
const RENAME_RETRY_CODES = new Set(['EEXIST', 'EPERM', 'ENOTEMPTY', 'EACCES', 'EXDEV']);
const CRASH_RETENTION_SCHEMA_VERSION = '1.0.0';
const CRASH_RETENTION_BUNDLE_FILE = 'retained-crash-bundle.json';
const CRASH_RETENTION_MARKER_FILE = 'retained-crash-bundle.consistency.json';
const CRASH_RETENTION_LOG_TAIL_LIMIT = 100;
const CRASH_RETENTION_SCHEDULER_EVENT_LIMIT = 40;
const CRASH_RETENTION_SCAN_MAX_DEPTH = 12;
const CRASH_RETENTION_FORENSIC_SCAN_MAX_FILES = 1200;
const CRASH_RETENTION_DURABLE_SCAN_MAX_FILES = 600;
const RETAINED_CRASH_LOG_BASENAMES = new Set([
  'index-crash.log',
  'index-crash-state.json',
  'index-crash-events.json',
  'index-crash-file-trace.ndjson',
  'index-crash-forensics-index.json'
]);

/**
 * Safely JSON-stringify values used in append-only log lines.
 *
 * @param {unknown} value
 * @returns {string}
 */
const safeStringify = (value) => {
  try {
    return JSON.stringify(value);
  } catch {
    return '"[unserializable]"';
  }
};

/**
 * Convert arbitrary values to filesystem-safe path token fragments.
 *
 * @param {unknown} value
 * @param {string} [fallback='unknown']
 * @returns {string}
 */
const sanitizePathToken = (value, fallback = 'unknown') => {
  const raw = value == null ? '' : String(value);
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  const cleaned = trimmed.replace(/[^a-zA-Z0-9._-]+/g, '_');
  return cleaned || fallback;
};

/**
 * Compute stable forensic payload signature for dedupe/indexing.
 *
 * @param {unknown} payload
 * @returns {string}
 */
const computeForensicSignature = (payload) => {
  try {
    return sha1(JSON.stringify(payload || null)).slice(0, 20);
  } catch {
    return sha1(String(payload || '')).slice(0, 20);
  }
};

/**
 * Extract recent non-empty lines from crash log text.
 *
 * @param {string} text
 * @param {number} [limit]
 * @returns {string[]}
 */
const extractLogTailLines = (text, limit = CRASH_RETENTION_LOG_TAIL_LIMIT) => {
  const rows = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!rows.length) return [];
  return rows.slice(-Math.max(1, Math.floor(limit)));
};

/**
 * Normalize scheduler event line/object into canonical retention shape.
 *
 * @param {object|string|null|undefined} entry
 * @returns {object|null}
 */
const normalizeSchedulerEventEntry = (entry) => {
  if (!entry) return null;
  if (typeof entry === 'string') {
    const message = entry.trim();
    if (!message) return null;
    return {
      ts: formatTimestamp(),
      message
    };
  }
  if (typeof entry !== 'object') return null;
  const message = typeof entry.message === 'string'
    ? entry.message.trim()
    : (
      typeof entry.line === 'string'
        ? entry.line.trim()
        : ''
    );
  if (!message) return null;
  const normalized = {
    ts: typeof entry.ts === 'string' && entry.ts ? entry.ts : formatTimestamp(),
    message
  };
  if (typeof entry.source === 'string' && entry.source) normalized.source = entry.source;
  if (typeof entry.stage === 'string' && entry.stage) normalized.stage = entry.stage;
  if (typeof entry.taskId === 'string' && entry.taskId) normalized.taskId = entry.taskId;
  if (typeof entry.level === 'string' && entry.level) normalized.level = entry.level;
  return normalized;
};

/**
 * Merge scheduler events from structured payloads + crash log tail.
 *
 * Filters to scheduler-tagged messages and deduplicates by stable digest.
 *
 * @param {{schedulerEvents?:Array<object|string>,crashLogTail?:string[]}} [input]
 * @returns {Array<object>}
 */
const mergeSchedulerEvents = ({ schedulerEvents = [], crashLogTail = [] }) => {
  const merged = [];
  const seen = new Set();
  const push = (entry) => {
    const normalized = normalizeSchedulerEventEntry(entry);
    if (!normalized) return;
    if (!normalized.message.includes('[tree-sitter:schedule]')) return;
    const key = sha1(`${normalized.message}|${normalized.stage || ''}|${normalized.taskId || ''}|${normalized.source || ''}`);
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(normalized);
  };
  for (const entry of Array.isArray(schedulerEvents) ? schedulerEvents : []) {
    push(entry);
  }
  for (const line of Array.isArray(crashLogTail) ? crashLogTail : []) {
    push({ source: 'index-crash.log', line });
  }
  if (merged.length <= CRASH_RETENTION_SCHEDULER_EVENT_LIMIT) return merged;
  return merged.slice(-CRASH_RETENTION_SCHEDULER_EVENT_LIMIT);
};

/**
 * Merge parser metadata candidates while removing structural duplicates.
 *
 * @param {{parserMetadata?:Array<object>,payload?:object|null}} [input]
 * @returns {Array<object>}
 */
const mergeParserMetadata = ({ parserMetadata = [], payload = null }) => {
  if (!payload || typeof payload !== 'object') return parserMetadata;
  const entries = Array.isArray(parserMetadata) ? parserMetadata.slice() : [];
  const seen = new Set(entries.map((entry) => sha1(safeStringify(entry))));
  const maybePush = (candidate) => {
    if (!candidate || typeof candidate !== 'object') return;
    const serialized = safeStringify(candidate);
    const digest = sha1(serialized);
    if (seen.has(digest)) return;
    seen.add(digest);
    entries.push(candidate);
  };
  maybePush(payload?.parser);
  const events = Array.isArray(payload?.events) ? payload.events : [];
  for (const event of events) maybePush(event?.parser);
  const bundle = payload?.bundle && typeof payload.bundle === 'object' ? payload.bundle : null;
  if (bundle) {
    maybePush(bundle?.parser);
    const bundleEvents = Array.isArray(bundle?.events) ? bundle.events : [];
    for (const event of bundleEvents) maybePush(event?.parser);
  }
  return entries;
};

/**
 * Ensure target parent directory exists.
 *
 * @param {string} targetPath
 * @returns {Promise<void>}
 */
const ensureParentDir = async (targetPath) => {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
};

/**
 * Atomically rename temp file to final path with retry for common Windows
 * rename races and cross-device replacement cases.
 *
 * @param {string} tempPath
 * @param {string} targetPath
 * @returns {Promise<void>}
 */
const renameWithFallback = async (tempPath, targetPath) => {
  try {
    await fs.rename(tempPath, targetPath);
  } catch (err) {
    if (!RENAME_RETRY_CODES.has(err?.code)) throw err;
    try {
      await fs.rm(targetPath, { force: true });
    } catch {}
    await fs.rename(tempPath, targetPath);
  }
};

/**
 * Copy one artifact through a temp file and atomic rename.
 *
 * @param {string} sourcePath
 * @param {string} targetPath
 * @returns {Promise<{bytes:number,sha1:string}>}
 */
const copyFileAtomic = async (sourcePath, targetPath) => {
  const tempPath = createTempPath(targetPath);
  try {
    await ensureParentDir(targetPath);
    await ensureParentDir(tempPath);
    const payload = await fs.readFile(sourcePath);
    await fs.writeFile(tempPath, payload);
    await renameWithFallback(tempPath, targetPath);
    return {
      bytes: payload.length,
      sha1: sha1(payload)
    };
  } catch (err) {
    try {
      await fs.rm(tempPath, { force: true });
    } catch {}
    throw err;
  }
};

/**
 * Recursively list files under one root directory.
 *
 * @param {string} rootDir
 * @param {{maxFiles?:number,maxDepth?:number,includeFile?:(filePath:string)=>boolean}} [options]
 * @returns {Promise<string[]>}
 */
const listFilesRecursive = async (
  rootDir,
  {
    maxFiles = Number.POSITIVE_INFINITY,
    maxDepth = CRASH_RETENTION_SCAN_MAX_DEPTH,
    includeFile = null
  } = {}
) => {
  const out = [];
  const boundedMaxFiles = Number.isFinite(maxFiles) && maxFiles > 0
    ? Math.max(1, Math.floor(maxFiles))
    : Number.POSITIVE_INFINITY;
  const boundedMaxDepth = Number.isFinite(maxDepth) && maxDepth >= 0
    ? Math.floor(maxDepth)
    : CRASH_RETENTION_SCAN_MAX_DEPTH;
  const walk = async (dirPath, depth) => {
    if (out.length >= boundedMaxFiles) return;
    if (depth > boundedMaxDepth) return;
    let rows = [];
    try {
      rows = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const row of rows) {
      if (out.length >= boundedMaxFiles) break;
      const next = path.join(dirPath, row.name);
      if (row.isDirectory()) {
        await walk(next, depth + 1);
        continue;
      }
      if (!row.isFile()) continue;
      if (typeof includeFile === 'function' && !includeFile(next)) continue;
      out.push(next);
    }
  };
  await walk(rootDir, 0);
  return out;
};

/**
 * Select crash-log and forensics artifacts eligible for retention bundles.
 *
 * @param {{repoCacheRoot:string}} input
 * @returns {Promise<Array<{sourcePath:string,relativePath:string}>>}
 */
const selectCrashArtifacts = async ({ repoCacheRoot }) => {
  const resolvedRepoCacheRoot = path.resolve(String(repoCacheRoot || ''));
  const logsDir = path.join(resolvedRepoCacheRoot, 'logs');
  const pathExists = async (targetPath) => {
    if (!targetPath) return false;
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  };
  const selected = [];
  for (const basename of RETAINED_CRASH_LOG_BASENAMES) {
    const sourcePath = path.join(logsDir, basename);
    if (!(await pathExists(sourcePath))) continue;
    selected.push({
      sourcePath,
      relativePath: path.join('logs', basename)
    });
  }
  const forensicsDir = path.join(logsDir, 'forensics');
  if (await pathExists(forensicsDir)) {
    const files = await listFilesRecursive(forensicsDir, {
      maxFiles: CRASH_RETENTION_FORENSIC_SCAN_MAX_FILES,
      includeFile: (filePath) => filePath.endsWith('.json')
    });
    for (const sourcePath of files) {
      const relativeForensics = path.relative(logsDir, sourcePath);
      selected.push({
        sourcePath,
        relativePath: path.join('logs', relativeForensics)
      });
    }
  }
  const durableDir = path.join(path.dirname(resolvedRepoCacheRoot), '_crash-forensics');
  if (await pathExists(durableDir)) {
    const repoToken = sanitizePathToken(path.basename(resolvedRepoCacheRoot), 'repo');
    const durableFiles = await listFilesRecursive(durableDir, {
      maxFiles: CRASH_RETENTION_DURABLE_SCAN_MAX_FILES,
      includeFile: (filePath) => path.basename(filePath).endsWith('crash-forensics.json')
    });
    for (const sourcePath of durableFiles) {
      const base = path.basename(sourcePath);
      if (!base.startsWith(`${repoToken}-`)) continue;
      selected.push({
        sourcePath,
        relativePath: path.join('external', '_crash-forensics', base)
      });
    }
  }
  return selected;
};

/**
 * Retain crash diagnostics in a durable run-level directory before cache cleanup.
 *
 * @param {object} input
 * @param {string} input.repoCacheRoot
 * @param {string} input.diagnosticsRoot
 * @param {string} [input.repoLabel]
 * @param {string} [input.repoSlug]
 * @param {string} [input.runId]
 * @param {object|null} [input.failure]
 * @param {object|null} [input.runtime]
 * @param {object|null} [input.environment]
 * @param {Array<object|string>} [input.schedulerEvents]
 * @param {Array<string>} [input.logTail]
 * @returns {Promise<object|null>}
 */
export async function retainCrashArtifacts({
  repoCacheRoot,
  diagnosticsRoot,
  repoLabel = null,
  repoSlug = null,
  runId = null,
  failure = null,
  runtime = null,
  environment = null,
  schedulerEvents = [],
  logTail = []
} = {}) {
  if (!repoCacheRoot || !diagnosticsRoot) return null;
  const resolvedRepoCacheRoot = path.resolve(repoCacheRoot);
  const resolvedDiagnosticsRoot = path.resolve(diagnosticsRoot);
  const artifactCandidates = await selectCrashArtifacts({ repoCacheRoot: resolvedRepoCacheRoot });
  const repoToken = sanitizePathToken(repoSlug || repoLabel || path.basename(resolvedRepoCacheRoot), 'repo');
  const targetDir = path.join(resolvedDiagnosticsRoot, repoToken);
  const copiedArtifacts = [];
  const copyErrors = [];
  let parserMetadata = [];
  let crashLogTail = [];

  for (const artifact of artifactCandidates) {
    const sourcePath = artifact?.sourcePath;
    const relativePath = artifact?.relativePath;
    if (!sourcePath || !relativePath) continue;
    const targetPath = path.join(targetDir, relativePath);
    try {
      const copied = await copyFileAtomic(sourcePath, targetPath);
      copiedArtifacts.push({
        sourcePath,
        path: targetPath,
        relativePath,
        bytes: copied.bytes,
        sha1: copied.sha1
      });
      if (path.basename(sourcePath) === 'index-crash.log') {
        try {
          const crashLogText = await fs.readFile(targetPath, 'utf8');
          crashLogTail = extractLogTailLines(crashLogText);
        } catch {}
      }
      if (sourcePath.endsWith('.json')) {
        try {
          const payload = JSON.parse(await fs.readFile(targetPath, 'utf8'));
          parserMetadata = mergeParserMetadata({ parserMetadata, payload });
        } catch {}
      }
    } catch (err) {
      copyErrors.push({
        sourcePath,
        relativePath,
        message: err?.message || String(err)
      });
    }
  }

  const resolvedSchedulerEvents = mergeSchedulerEvents({
    schedulerEvents,
    crashLogTail
  });
  const resolvedLogTail = Array.isArray(logTail)
    ? logTail
      .map((line) => String(line || '').trim())
      .filter(Boolean)
      .slice(-CRASH_RETENTION_LOG_TAIL_LIMIT)
    : [];
  if (!copiedArtifacts.length && !copyErrors.length && !resolvedSchedulerEvents.length) {
    return null;
  }
  const retainedAt = formatTimestamp();
  const bundleWithoutChecksum = {
    schemaVersion: CRASH_RETENTION_SCHEMA_VERSION,
    retainedAt,
    runId: runId || null,
    repoLabel: repoLabel || null,
    repoCacheRoot: resolvedRepoCacheRoot,
    failure: failure || null,
    runtime: runtime || null,
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      ...(environment && typeof environment === 'object' ? environment : {})
    },
    parserMetadata,
    schedulerEvents: resolvedSchedulerEvents,
    logTail: resolvedLogTail,
    copiedArtifacts: copiedArtifacts.map((entry) => ({
      path: entry.path,
      relativePath: entry.relativePath,
      bytes: entry.bytes,
      checksum: `sha1:${entry.sha1}`
    })),
    copyErrors
  };
  const checksum = sha1(JSON.stringify(bundleWithoutChecksum));
  const bundle = {
    ...bundleWithoutChecksum,
    consistency: {
      marker: 'complete',
      checksum: `sha1:${checksum}`
    }
  };
  const bundlePath = path.join(targetDir, CRASH_RETENTION_BUNDLE_FILE);
  const markerPath = path.join(targetDir, CRASH_RETENTION_MARKER_FILE);
  await atomicWriteJson(bundlePath, bundle, { spaces: 2 });
  await atomicWriteJson(markerPath, {
    schemaVersion: CRASH_RETENTION_SCHEMA_VERSION,
    generatedAt: retainedAt,
    marker: 'complete',
    checksum: `sha1:${checksum}`,
    bundleFile: path.basename(bundlePath),
    artifactCount: copiedArtifacts.length,
    copyErrorCount: copyErrors.length
  }, { spaces: 2 });
  return {
    bundlePath,
    markerPath,
    diagnosticsDir: targetDir,
    artifactCount: copiedArtifacts.length,
    copyErrorCount: copyErrors.length,
    parserMetadataCount: parserMetadata.length,
    schedulerEventCount: resolvedSchedulerEvents.length,
    checksum: `sha1:${checksum}`
  };
};

/**
 * Create crash logger façade used by indexing runtime for crash diagnostics.
 *
 * @param {{repoCacheRoot:string,enabled:boolean}} input
 * @returns {Promise<object>}
 */
export async function createCrashLogger({ repoCacheRoot, enabled }) {
  if (!enabled || !repoCacheRoot) {
    return {
      enabled: false,
      updatePhase: () => {},
      updateFile: () => {},
      traceFileStage: () => {},
      logError: () => {},
      persistForensicBundle: async () => null
    };
  }
  const logsDir = path.join(repoCacheRoot, 'logs');
  const statePath = path.join(logsDir, 'index-crash-state.json');
  const logPath = path.join(logsDir, 'index-crash.log');
  const eventsPath = path.join(logsDir, 'index-crash-events.json');
  const tracePath = path.join(logsDir, 'index-crash-file-trace.ndjson');
  const forensicsDir = path.join(logsDir, 'forensics');
  const forensicsIndexPath = path.join(logsDir, 'index-crash-forensics-index.json');
  const forensicSignatures = new Set();
  const forensicBundleIndex = new Map();
  const ioWarnings = new Set();
  let currentPhase = null;
  let currentFile = null;
  const warnIo = (action, err) => {
    const message = err?.message || String(err);
    const code = err?.code || 'ERR_IO';
    const key = `${action}:${code}:${message}`;
    if (ioWarnings.has(key)) return;
    ioWarnings.add(key);
    console.warn(`[crash-log] ${action} failed (${code}): ${message}`);
  };
  try {
    await fs.mkdir(logsDir, { recursive: true });
    await fs.appendFile(logPath, '');
    await fs.appendFile(tracePath, '');
  } catch (err) {
    warnIo('initialize crash log files', err);
  }

  const writeState = async (state) => {
    const payload = { ts: formatTimestamp(), ...state };
    try {
      await atomicWriteJson(statePath, payload, { spaces: 2 });
    } catch (err) {
      warnIo('write crash state', err);
    }
  };

  const appendLine = async (message, extra) => {
    const suffix = extra ? ` ${safeStringify(extra)}` : '';
    const line = `[${formatTimestamp()}] ${message}${suffix}\n`;
    try {
      await fs.appendFile(logPath, line);
    } catch (err) {
      warnIo('append crash log', err);
    }
  };
  const appendTrace = async (event) => {
    if (!event || typeof event !== 'object') return;
    const payload = {
      ts: formatTimestamp(),
      phase: event.phase || currentPhase || null,
      ...event
    };
    try {
      await fs.appendFile(tracePath, `${safeStringify(payload)}\n`);
    } catch (err) {
      warnIo('append crash trace', err);
    }
  };
  const writeStateSync = (state) => {
    const payload = { ts: formatTimestamp(), ...state };
    try {
      atomicWriteJsonSync(statePath, payload, { spaces: 2, newline: false });
    } catch (err) {
      warnIo('write crash state sync', err);
    }
  };
  const appendLineSync = (message, extra) => {
    const suffix = extra ? ` ${safeStringify(extra)}` : '';
    const line = `[${formatTimestamp()}] ${message}${suffix}\n`;
    try {
      fsSync.appendFileSync(logPath, line);
    } catch (err) {
      warnIo('append crash log sync', err);
    }
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
    } catch (err) {
      warnIo('persist forensic bundle', err);
      return null;
    }
  };

  void appendLine('crash-logger initialized', { path: logPath });

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
    traceFileStage(entry) {
      void appendTrace(entry);
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
          atomicWriteJsonSync(eventsPath, { ts: formatTimestamp(), events: recentEvents }, { spaces: 2, newline: false });
        } catch (err) {
          warnIo('write crash events snapshot', err);
        }
      }
    },
    persistForensicBundle
  };
}
