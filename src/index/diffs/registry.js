import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { acquireIndexLock } from '../build/lock.js';
import { createError, ERROR_CODES } from '../../shared/error-codes.js';
import { isAbsolutePathAny, toPosix } from '../../shared/files.js';
import { sha1 } from '../../shared/hash.js';
import { atomicWriteText } from '../../shared/io/atomic-write.js';
import { stableStringify } from '../../shared/stable-json.js';
import { parseIndexRef, redactIndexRefForPersistence } from '../index-ref.js';
import { isManifestPathSafe } from '../validate/paths.js';

const DIFFS_DIR = 'diffs';
const DIFF_ID_RE = /^diff_[A-Za-z0-9._-]+$/;

const queueError = (message, details = null) => createError(ERROR_CODES.QUEUE_OVERLOADED, message, details);
const invalidRequest = (message, details = null) => createError(ERROR_CODES.INVALID_REQUEST, message, details);

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
const resolveDiffsRoot = (repoCacheRoot) => path.join(repoCacheRoot, DIFFS_DIR);
const resolveManifestPath = (repoCacheRoot) => path.join(resolveDiffsRoot(repoCacheRoot), 'manifest.json');
const resolveDiffDir = (repoCacheRoot, diffId) => path.join(resolveDiffsRoot(repoCacheRoot), diffId);
const resolveInputsPath = (repoCacheRoot, diffId) => path.join(resolveDiffDir(repoCacheRoot, diffId), 'inputs.json');
const resolveSummaryPath = (repoCacheRoot, diffId) => path.join(resolveDiffDir(repoCacheRoot, diffId), 'summary.json');

const ensureDiffId = (diffId) => {
  if (typeof diffId !== 'string' || !DIFF_ID_RE.test(diffId)) {
    throw invalidRequest(`Invalid diff id: ${diffId}`);
  }
};

const deepClone = (value) => JSON.parse(JSON.stringify(value));

const assertNoAbsolutePathLeak = (value, cursor = '$') => {
  if (typeof value === 'string') {
    if (isAbsolutePathAny(value)) {
      throw invalidRequest(`Absolute path leak at ${cursor}.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      assertNoAbsolutePathLeak(value[i], `${cursor}[${i}]`);
    }
    return;
  }
  if (!isObject(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    assertNoAbsolutePathLeak(entry, `${cursor}.${key}`);
  }
};

const normalizeRelativePath = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw invalidRequest(`${label} must be a non-empty path string.`);
  }
  const normalized = toPosix(value.trim());
  if (!isManifestPathSafe(normalized)) {
    throw invalidRequest(`${label} must be repo-cache-relative and traversal-safe.`);
  }
  return normalized;
};

const redactRawPathValue = (rawPath) => ({
  redacted: 'path:<redacted>',
  pathHash: sha1(path.resolve(String(rawPath)))
});

const sanitizeDiffEndpoint = (endpoint, { persistUnsafe }) => {
  if (typeof endpoint === 'string') {
    const parsed = parseIndexRef(endpoint);
    const persisted = redactIndexRefForPersistence(parsed, { persistUnsafe });
    return persisted.redacted
      ? { ref: persisted.ref, pathHash: persisted.pathHash }
      : endpoint;
  }
  if (!isObject(endpoint)) return endpoint;
  const next = { ...endpoint };
  if (typeof next.ref === 'string') {
    const parsed = parseIndexRef(next.ref);
    const persisted = redactIndexRefForPersistence(parsed, { persistUnsafe });
    next.ref = persisted.ref;
    if (persisted.pathHash) next.pathHash = persisted.pathHash;
  }
  if (typeof next.indexRootRef === 'string') {
    const value = next.indexRootRef.trim();
    if (value.startsWith('path:')) {
      const parsed = parseIndexRef(value);
      const persisted = redactIndexRefForPersistence(parsed, { persistUnsafe });
      next.indexRootRef = persisted.ref;
      if (persisted.pathHash) next.indexRootPathHash = persisted.pathHash;
    } else if (isAbsolutePathAny(value)) {
      if (persistUnsafe !== true) {
        throw invalidRequest('Absolute indexRootRef cannot be persisted without --persist-unsafe.');
      }
      const redacted = redactRawPathValue(value);
      next.indexRootRef = redacted.redacted;
      next.indexRootPathHash = redacted.pathHash;
    } else {
      next.indexRootRef = normalizeRelativePath(value, 'indexRootRef');
    }
  }
  return next;
};

const sanitizeDiffManifest = (manifest, options) => {
  const next = deepClone(manifest);
  if (isObject(next.diffs)) {
    for (const entry of Object.values(next.diffs)) {
      if (!isObject(entry)) continue;
      if (typeof entry.summaryPath === 'string') {
        entry.summaryPath = normalizeRelativePath(entry.summaryPath, 'summaryPath');
      }
      if (typeof entry.eventsPath === 'string') {
        entry.eventsPath = normalizeRelativePath(entry.eventsPath, 'eventsPath');
      }
      if (Object.prototype.hasOwnProperty.call(entry, 'from')) {
        entry.from = sanitizeDiffEndpoint(entry.from, options);
      }
      if (Object.prototype.hasOwnProperty.call(entry, 'to')) {
        entry.to = sanitizeDiffEndpoint(entry.to, options);
      }
    }
  }
  assertNoAbsolutePathLeak(next);
  return next;
};

const sanitizeDiffInputs = (inputs, options) => {
  const next = deepClone(inputs);
  if (Object.prototype.hasOwnProperty.call(next, 'from')) {
    next.from = sanitizeDiffEndpoint(next.from, options);
  }
  if (Object.prototype.hasOwnProperty.call(next, 'to')) {
    next.to = sanitizeDiffEndpoint(next.to, options);
  }
  assertNoAbsolutePathLeak(next);
  return next;
};

const sanitizeDiffSummary = (summary, options) => {
  const next = deepClone(summary);
  if (Object.prototype.hasOwnProperty.call(next, 'from')) {
    next.from = sanitizeDiffEndpoint(next.from, options);
  }
  if (Object.prototype.hasOwnProperty.call(next, 'to')) {
    next.to = sanitizeDiffEndpoint(next.to, options);
  }
  assertNoAbsolutePathLeak(next);
  return next;
};

const readJsonObject = (filePath, fallback = null) => {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!isObject(payload)) {
      throw new Error('payload must be an object');
    }
    return payload;
  } catch (err) {
    throw invalidRequest(`Invalid JSON at ${filePath}: ${err?.message || err}`, { cause: err });
  }
};

const writeStableJson = async (filePath, payload) => {
  await atomicWriteText(filePath, stableStringify(payload), { newline: true });
};

const withIndexLock = async (repoCacheRoot, options, worker) => {
  const lockInput = isObject(options?.lock) ? options.lock : null;
  if (lockInput && typeof lockInput.release === 'function') {
    return worker(lockInput);
  }
  const lock = await acquireIndexLock({
    repoCacheRoot,
    waitMs: Number.isFinite(options?.waitMs) ? Number(options.waitMs) : 0,
    pollMs: Number.isFinite(options?.pollMs) ? Number(options.pollMs) : 1000,
    staleMs: Number.isFinite(options?.staleMs) ? Number(options.staleMs) : undefined,
    log: typeof options?.log === 'function' ? options.log : () => {}
  });
  if (!lock) {
    throw queueError('Index lock held; unable to write diff registry.');
  }
  try {
    return await worker(lock);
  } finally {
    await lock.release();
  }
};

export const createEmptyDiffsManifest = () => ({
  version: 1,
  updatedAt: null,
  diffs: {}
});

export const loadDiffsManifest = (repoCacheRoot) => (
  readJsonObject(resolveManifestPath(repoCacheRoot), createEmptyDiffsManifest())
);

export const loadDiffInputs = (repoCacheRoot, diffId) => {
  ensureDiffId(diffId);
  return readJsonObject(resolveInputsPath(repoCacheRoot, diffId), null);
};

export const loadDiffSummary = (repoCacheRoot, diffId) => {
  ensureDiffId(diffId);
  return readJsonObject(resolveSummaryPath(repoCacheRoot, diffId), null);
};

export const writeDiffsManifest = async (repoCacheRoot, manifest, options = {}) => {
  if (!isObject(manifest)) {
    throw invalidRequest('Diff manifest must be an object.');
  }
  const sanitized = sanitizeDiffManifest(manifest, {
    persistUnsafe: options.persistUnsafe === true
  });
  return withIndexLock(repoCacheRoot, options, async () => {
    const manifestPath = resolveManifestPath(repoCacheRoot);
    await fsPromises.mkdir(path.dirname(manifestPath), { recursive: true });
    await writeStableJson(manifestPath, sanitized);
    return manifestPath;
  });
};

export const writeDiffInputs = async (repoCacheRoot, diffId, inputs, options = {}) => {
  ensureDiffId(diffId);
  if (!isObject(inputs)) {
    throw invalidRequest('inputs.json payload must be an object.');
  }
  const sanitized = sanitizeDiffInputs(inputs, {
    persistUnsafe: options.persistUnsafe === true
  });
  return withIndexLock(repoCacheRoot, options, async () => {
    const filePath = resolveInputsPath(repoCacheRoot, diffId);
    await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
    await writeStableJson(filePath, sanitized);
    return filePath;
  });
};

export const writeDiffSummary = async (repoCacheRoot, diffId, summary, options = {}) => {
  ensureDiffId(diffId);
  if (!isObject(summary)) {
    throw invalidRequest('summary.json payload must be an object.');
  }
  const sanitized = sanitizeDiffSummary(summary, {
    persistUnsafe: options.persistUnsafe === true
  });
  return withIndexLock(repoCacheRoot, options, async () => {
    const filePath = resolveSummaryPath(repoCacheRoot, diffId);
    await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
    await writeStableJson(filePath, sanitized);
    return filePath;
  });
};
