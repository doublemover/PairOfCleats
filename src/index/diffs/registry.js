import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { acquireIndexLock } from '../build/lock.js';
import { createError, ERROR_CODES } from '../../shared/error-codes.js';
import { atomicWriteText } from '../../shared/io/atomic-write.js';
import { stableStringify } from '../../shared/stable-json.js';

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
  return withIndexLock(repoCacheRoot, options, async () => {
    const manifestPath = resolveManifestPath(repoCacheRoot);
    await fsPromises.mkdir(path.dirname(manifestPath), { recursive: true });
    await writeStableJson(manifestPath, manifest);
    return manifestPath;
  });
};

export const writeDiffInputs = async (repoCacheRoot, diffId, inputs, options = {}) => {
  ensureDiffId(diffId);
  if (!isObject(inputs)) {
    throw invalidRequest('inputs.json payload must be an object.');
  }
  return withIndexLock(repoCacheRoot, options, async () => {
    const filePath = resolveInputsPath(repoCacheRoot, diffId);
    await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
    await writeStableJson(filePath, inputs);
    return filePath;
  });
};

export const writeDiffSummary = async (repoCacheRoot, diffId, summary, options = {}) => {
  ensureDiffId(diffId);
  if (!isObject(summary)) {
    throw invalidRequest('summary.json payload must be an object.');
  }
  return withIndexLock(repoCacheRoot, options, async () => {
    const filePath = resolveSummaryPath(repoCacheRoot, diffId);
    await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
    await writeStableJson(filePath, summary);
    return filePath;
  });
};

