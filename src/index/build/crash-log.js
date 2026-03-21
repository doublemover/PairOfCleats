import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import readline from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { getRecentLogEvents } from '../../shared/progress.js';
import { createTempPath } from '../../shared/json-stream/atomic.js';
import { createQueuedAppendWriter } from '../../shared/io/append-writer.js';
import { atomicWriteJson, atomicWriteJsonSync, atomicWriteTextSync } from '../../shared/io/atomic-write.js';
import { sha1 } from '../../shared/hash.js';
import { normalizeFailureEvent, validateFailureEvent } from './failure-taxonomy.js';

/**
 * Produce ISO-8601 timestamp for crash log entries.
 *
 * @returns {string}
 */
const formatTimestamp = () => new Date().toISOString();
const RENAME_RETRY_CODES = new Set(['EEXIST', 'EPERM', 'ENOTEMPTY', 'EACCES', 'EXDEV']);
const CRASH_RETENTION_SCHEMA_VERSION = '1.1.0';
const CRASH_RETENTION_BUNDLE_FILE = 'retained-crash-bundle.json';
const CRASH_RETENTION_MARKER_FILE = 'retained-crash-bundle.consistency.json';
const CRASH_RETENTION_LOG_TAIL_LIMIT = 100;
const CRASH_RETENTION_SCHEDULER_EVENT_LIMIT = 40;
const CRASH_RETENTION_SCAN_MAX_DEPTH = 12;
const CRASH_RETENTION_FORENSIC_SCAN_MAX_FILES = 1200;
const CRASH_RETENTION_DURABLE_SCAN_MAX_FILES = 600;
const CRASH_RETENTION_PROFILE_ENV = 'PAIROFCLEATS_CRASH_RETENTION_PROFILE';
const CRASH_RETENTION_FULL_TRACE_ENV = 'PAIROFCLEATS_CRASH_RETENTION_FULL_TRACE';
const CRASH_RETENTION_DEFAULT_BUNDLE_BUDGET_BYTES = 32 * 1024 * 1024;
const CRASH_RETENTION_DEFAULT_FULL_TRACE_MAX_BYTES = 2 * 1024 * 1024;
const CRASH_RETENTION_TRACE_HEAD_LIMIT = 24;
const CRASH_RETENTION_TRACE_TAIL_LIMIT = 48;
const CRASH_RETENTION_TRACE_TOP_LIMIT = 10;
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

const normalizeCrashRetentionProfile = (value) => {
  const text = String(value || '').trim().toLowerCase();
  return text === 'full' ? 'full' : 'default';
};

const resolveCrashRetentionPolicy = () => {
  const profile = normalizeCrashRetentionProfile(process.env[CRASH_RETENTION_PROFILE_ENV]);
  const fullTraceEnabled = profile === 'full' || process.env[CRASH_RETENTION_FULL_TRACE_ENV] === '1';
  return {
    profile: fullTraceEnabled ? 'full' : 'default',
    bundleBudgetBytes: CRASH_RETENTION_DEFAULT_BUNDLE_BUDGET_BYTES,
    fullTraceMaxBytes: fullTraceEnabled
      ? Number.POSITIVE_INFINITY
      : CRASH_RETENTION_DEFAULT_FULL_TRACE_MAX_BYTES,
    traceHeadLimit: CRASH_RETENTION_TRACE_HEAD_LIMIT,
    traceTailLimit: CRASH_RETENTION_TRACE_TAIL_LIMIT,
    traceTopLimit: CRASH_RETENTION_TRACE_TOP_LIMIT,
    fullTraceEnabled
  };
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
  const digest = crypto.createHash('sha1');
  let bytes = 0;
  try {
    await ensureParentDir(targetPath);
    await ensureParentDir(tempPath);
    await pipeline(
      fsSync.createReadStream(sourcePath),
      fsSync.createWriteStream(tempPath)
    );
    const stream = fsSync.createReadStream(tempPath);
    await new Promise((resolve, reject) => {
      stream.on('data', (chunk) => {
        bytes += chunk.length;
        digest.update(chunk);
      });
      stream.once('error', reject);
      stream.once('end', resolve);
    });
    let handle = null;
    try {
      handle = await fs.open(tempPath, 'r+');
      await handle.sync();
    } finally {
      await handle?.close().catch(() => {});
    }
    await renameWithFallback(tempPath, targetPath);
    return {
      bytes,
      sha1: digest.digest('hex')
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

const toSortedCountEntries = (map, limit = CRASH_RETENTION_TRACE_TOP_LIMIT) => Array.from(map.entries())
  .sort((left, right) => (right[1] - left[1]) || String(left[0]).localeCompare(String(right[0])))
  .slice(0, Math.max(1, Math.floor(limit)))
  .map(([value, count]) => ({ value, count }));

const appendRingSample = (items, value, limit) => {
  items.push(value);
  if (items.length > limit) items.shift();
};

const maybeParseTraceEntry = (line) => {
  try {
    return JSON.parse(line);
  } catch {
    return { raw: line };
  }
};

const buildTraceSampleEntry = (entry) => {
  if (!entry || typeof entry !== 'object') return entry;
  return {
    ts: entry.ts || null,
    phase: entry.phase || null,
    stage: entry.stage || null,
    substage: entry.substage || null,
    file: entry.file || null,
    mode: entry.mode || null,
    ...(entry.errorCode ? { errorCode: entry.errorCode } : {}),
    ...(entry.errorName ? { errorName: entry.errorName } : {}),
    ...(entry.errorMessage ? { errorMessage: entry.errorMessage } : {}),
    ...(entry.raw ? { raw: entry.raw } : {})
  };
};

const summarizeCrashTrace = async ({
  sourcePath,
  summaryPath,
  sourceBytes,
  policy
}) => {
  const phaseCounts = new Map();
  const stageCounts = new Map();
  const substageCounts = new Map();
  const fileCounts = new Map();
  const head = [];
  const tail = [];
  let totalEvents = 0;
  let parsedEvents = 0;
  let rawEvents = 0;
  let maxFileIndex = null;
  const input = fsSync.createReadStream(sourcePath, { encoding: 'utf8' });
  const reader = readline.createInterface({
    input,
    crlfDelay: Infinity
  });
  try {
    for await (const line of reader) {
      const trimmed = String(line || '').trim();
      if (!trimmed) continue;
      totalEvents += 1;
      const entry = maybeParseTraceEntry(trimmed);
      const parsed = !Object.prototype.hasOwnProperty.call(entry, 'raw');
      if (parsed) parsedEvents += 1;
      else rawEvents += 1;
      const sample = buildTraceSampleEntry(entry);
      if (head.length < policy.traceHeadLimit) head.push(sample);
      appendRingSample(tail, sample, policy.traceTailLimit);
      const phase = String(entry?.phase || '').trim();
      const stage = String(entry?.stage || '').trim();
      const substage = String(entry?.substage || '').trim();
      const file = String(entry?.file || '').trim();
      const fileIndex = Number(entry?.fileIndex);
      if (phase) phaseCounts.set(phase, (phaseCounts.get(phase) || 0) + 1);
      if (stage) stageCounts.set(stage, (stageCounts.get(stage) || 0) + 1);
      if (substage) substageCounts.set(substage, (substageCounts.get(substage) || 0) + 1);
      if (file) fileCounts.set(file, (fileCounts.get(file) || 0) + 1);
      if (Number.isFinite(fileIndex)) {
        maxFileIndex = Number.isFinite(maxFileIndex) ? Math.max(maxFileIndex, fileIndex) : fileIndex;
      }
    }
  } finally {
    reader.close();
  }
  const payload = {
    schemaVersion: CRASH_RETENTION_SCHEMA_VERSION,
    kind: 'crash-trace-summary',
    sourceFile: path.basename(sourcePath),
    sourceBytes,
    policy: {
      profile: policy.profile,
      fullTraceMaxBytes: Number.isFinite(policy.fullTraceMaxBytes) ? policy.fullTraceMaxBytes : null,
      traceHeadLimit: policy.traceHeadLimit,
      traceTailLimit: policy.traceTailLimit,
      traceTopLimit: policy.traceTopLimit
    },
    eventCount: totalEvents,
    parsedEventCount: parsedEvents,
    rawEventCount: rawEvents,
    maxFileIndex,
    countsByPhase: Object.fromEntries(toSortedCountEntries(phaseCounts, policy.traceTopLimit).map((entry) => [entry.value, entry.count])),
    countsByStage: Object.fromEntries(toSortedCountEntries(stageCounts, policy.traceTopLimit).map((entry) => [entry.value, entry.count])),
    countsBySubstage: Object.fromEntries(toSortedCountEntries(substageCounts, policy.traceTopLimit).map((entry) => [entry.value, entry.count])),
    topFiles: toSortedCountEntries(fileCounts, policy.traceTopLimit),
    head,
    tail
  };
  await atomicWriteJson(summaryPath, payload, { spaces: 2 });
  const summaryStats = await fs.stat(summaryPath);
  return {
    path: summaryPath,
    bytes: summaryStats.size,
    payload
  };
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
      includeFile: (filePath) => {
        const base = path.basename(filePath);
        return base.startsWith(`${repoToken}-`) && base.endsWith('crash-forensics.json');
      }
    });
    for (const sourcePath of durableFiles) {
      const base = path.basename(sourcePath);
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
  const retentionPolicy = resolveCrashRetentionPolicy();
  const artifactCandidates = await selectCrashArtifacts({ repoCacheRoot: resolvedRepoCacheRoot });
  const repoToken = sanitizePathToken(repoSlug || repoLabel || path.basename(resolvedRepoCacheRoot), 'repo');
  const targetDir = path.join(resolvedDiagnosticsRoot, repoToken);
  const copiedArtifacts = [];
  const retainedArtifacts = [];
  const copyErrors = [];
  const retentionDecisions = [];
  let parserMetadata = [];
  let crashLogTail = [];
  let retainedBytesTotal = 0;

  for (const artifact of artifactCandidates) {
    const sourcePath = artifact?.sourcePath;
    const relativePath = artifact?.relativePath;
    if (!sourcePath || !relativePath) continue;
    const targetPath = path.join(targetDir, relativePath);
    let sourceBytes = null;
    try {
      const sourceStat = await fs.stat(sourcePath);
      sourceBytes = sourceStat.size;
    } catch {}
    const baseName = path.basename(sourcePath);
    try {
      if (
        baseName === 'index-crash-file-trace.ndjson'
        && !retentionPolicy.fullTraceEnabled
        && Number.isFinite(sourceBytes)
        && sourceBytes > retentionPolicy.fullTraceMaxBytes
      ) {
        const summaryRelativePath = path.join('logs', 'index-crash-file-trace.summary.json');
        const summaryPath = path.join(targetDir, summaryRelativePath);
        const summary = await summarizeCrashTrace({
          sourcePath,
          summaryPath,
          sourceBytes,
          policy: retentionPolicy
        });
        retainedBytesTotal += summary.bytes;
        retainedArtifacts.push({
          sourcePath,
          path: summary.path,
          relativePath: summaryRelativePath,
          bytes: summary.bytes,
          sha1: sha1(JSON.stringify(summary.payload))
        });
        retentionDecisions.push({
          sourcePath,
          relativePath,
          sourceBytes,
          retentionKind: 'summary',
          reason: 'trace_exceeded_full_copy_budget',
          retainedArtifacts: [
            {
              path: summary.path,
              relativePath: summaryRelativePath,
              bytes: summary.bytes,
              kind: 'crash-trace-summary'
            }
          ],
          policy: {
            profile: retentionPolicy.profile,
            fullTraceMaxBytes: retentionPolicy.fullTraceMaxBytes,
            bundleBudgetBytes: retentionPolicy.bundleBudgetBytes
          }
        });
        continue;
      }
      const copied = await copyFileAtomic(sourcePath, targetPath);
      retainedBytesTotal += copied.bytes;
      copiedArtifacts.push({
        sourcePath,
        path: targetPath,
        relativePath,
        bytes: copied.bytes,
        sha1: copied.sha1
      });
      retainedArtifacts.push({
        sourcePath,
        path: targetPath,
        relativePath,
        bytes: copied.bytes,
        sha1: copied.sha1
      });
      retentionDecisions.push({
        sourcePath,
        relativePath,
        sourceBytes: Number.isFinite(sourceBytes) ? sourceBytes : copied.bytes,
        retentionKind: 'full',
        reason: 'retained_full',
        retainedArtifacts: [
          {
            path: targetPath,
            relativePath,
            bytes: copied.bytes,
            kind: 'file-copy'
          }
        ],
        policy: {
          profile: retentionPolicy.profile,
          fullTraceMaxBytes: Number.isFinite(retentionPolicy.fullTraceMaxBytes)
            ? retentionPolicy.fullTraceMaxBytes
            : null,
          bundleBudgetBytes: retentionPolicy.bundleBudgetBytes
        }
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
      retentionDecisions.push({
        sourcePath,
        relativePath,
        sourceBytes,
        retentionKind: 'error',
        reason: 'retention_copy_failed',
        retainedArtifacts: [],
        error: err?.message || String(err),
        policy: {
          profile: retentionPolicy.profile,
          fullTraceMaxBytes: Number.isFinite(retentionPolicy.fullTraceMaxBytes)
            ? retentionPolicy.fullTraceMaxBytes
            : null,
          bundleBudgetBytes: retentionPolicy.bundleBudgetBytes
        }
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
  if (!retainedArtifacts.length && !copyErrors.length && !resolvedSchedulerEvents.length) {
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
    retentionPolicy: {
      profile: retentionPolicy.profile,
      bundleBudgetBytes: retentionPolicy.bundleBudgetBytes,
      fullTraceMaxBytes: Number.isFinite(retentionPolicy.fullTraceMaxBytes)
        ? retentionPolicy.fullTraceMaxBytes
        : null,
      fullTraceEnabled: retentionPolicy.fullTraceEnabled,
      retainedBytesTotal
    },
    parserMetadata,
    schedulerEvents: resolvedSchedulerEvents,
    logTail: resolvedLogTail,
    copiedArtifacts: retainedArtifacts.map((entry) => ({
      path: entry.path,
      relativePath: entry.relativePath,
      bytes: entry.bytes,
      checksum: `sha1:${entry.sha1}`
    })),
    retentionDecisions,
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
    artifactCount: retainedArtifacts.length,
    copyErrorCount: copyErrors.length
  }, { spaces: 2 });
  return {
    bundlePath,
    markerPath,
    diagnosticsDir: targetDir,
    artifactCount: retainedArtifacts.length,
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
      persistForensicBundle: async () => null,
      flush: async () => {},
      close: async () => {}
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
  let queuedState = null;
  let stateWriteInFlight = null;
  let currentPhase = null;
  let currentFile = null;
  /**
   * Emit one crash-log IO warning per unique failure signature.
   *
   * Repeated write failures are common during lock contention; deduping by
   * action/code/message keeps logs readable while still surfacing the issue.
   *
   * @param {string} action
   * @param {unknown} err
   * @returns {void}
   */
  const warnIo = (action, err) => {
    const message = err?.message || String(err);
    const code = err?.code || 'ERR_IO';
    const causeCode = err?.causeCode || err?.cause?.code || '';
    const targetPath = typeof err?.path === 'string' ? err.path : '';
    const key = `${action}:${code}:${causeCode}:${targetPath}`;
    if (ioWarnings.has(key)) return;
    ioWarnings.add(key);
    console.warn(`[crash-log] ${action} failed (${code}): ${message}`);
  };
  try {
    await fs.mkdir(logsDir, { recursive: true });
  } catch (err) {
    warnIo('initialize crash log directories', err);
  }
  const createCrashAppendWriter = (filePath, warnAction) => createQueuedAppendWriter({
    filePath,
    syncOnFlush: true,
    onError(stage, err) {
      if (stage === 'open') warnIo(`initialize ${warnAction}`, err);
      else if (stage === 'flush') warnIo(`${warnAction} flush`, err);
      else if (stage === 'close') warnIo(`${warnAction} close`, err);
      else warnIo(warnAction, err);
    }
  });
  const logWriter = createCrashAppendWriter(logPath, 'append crash log');
  const traceWriter = createCrashAppendWriter(tracePath, 'append crash trace');

  const flushStateWrites = async () => {
    if (stateWriteInFlight) return stateWriteInFlight;
    stateWriteInFlight = (async () => {
      while (queuedState) {
        const nextState = queuedState;
        queuedState = null;
        const payload = { ts: formatTimestamp(), ...nextState };
        try {
          await atomicWriteJson(statePath, payload, { spaces: 2 });
        } catch (err) {
          warnIo('write crash state', err);
        }
      }
    })();
    try {
      await stateWriteInFlight;
    } finally {
      stateWriteInFlight = null;
      if (queuedState) void flushStateWrites();
    }
    return stateWriteInFlight;
  };

  const writeState = (state) => {
    queuedState = state && typeof state === 'object' ? { ...state } : {};
    void flushStateWrites();
  };

  const appendLine = async (message, extra) => {
    const suffix = extra ? ` ${safeStringify(extra)}` : '';
    const line = `[${formatTimestamp()}] ${message}${suffix}\n`;
    await logWriter.enqueue(line);
  };
  const appendTrace = async (event) => {
    if (!event || typeof event !== 'object') return;
    const payload = {
      ts: formatTimestamp(),
      phase: event.phase || currentPhase || null,
      ...event
    };
    await traceWriter.enqueue(`${safeStringify(payload)}\n`);
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
      const existing = fsSync.existsSync(logPath) ? fsSync.readFileSync(logPath, 'utf8') : '';
      atomicWriteTextSync(logPath, `${existing}${line}`, { newline: false });
    } catch (err) {
      warnIo('append crash log sync', err);
    }
  };

  /**
   * Persist one forensic bundle to disk with signature-level dedupe.
   *
   * Returns the existing path when a signature was already written in this
   * process, otherwise writes payload + index entries and returns new path.
   *
   * @param {{kind?:string,signature?:string|null,bundle?:object|null,meta?:object|null}} [input]
   * @returns {Promise<string|null>}
   */
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

  const flush = async () => {
    await flushStateWrites();
    await Promise.all([
      logWriter.flush(),
      traceWriter.flush()
    ]);
  };

  const close = async () => {
    await flush();
    await Promise.all([
      logWriter.close(),
      traceWriter.close()
    ]);
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
    persistForensicBundle,
    flush,
    close
  };
}
