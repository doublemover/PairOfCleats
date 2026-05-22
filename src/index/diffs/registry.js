import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { isAbsolutePathAny } from '../../shared/file-paths.js';
import { sha1 } from '../../shared/hash.js';
import { parseIndexRef, redactIndexRefForPersistence } from '../index-ref.js';
import {
  assertNoAbsolutePathLeak,
  deepCloneRegistryJson,
  ensureRegistryId,
  isRegistryObject,
  normalizeRegistryRelativePath,
  readRegistryJsonObject,
  registryInvalidRequest,
  withRegistryLock,
  writeRegistryStableJson
} from '../registry-support.js';

const DIFFS_DIR = 'diffs';
const DIFF_ID_RE = /^diff_[A-Za-z0-9._-]+$/;

const invalidRequest = registryInvalidRequest;
const isObject = isRegistryObject;
const resolveDiffsRoot = (repoCacheRoot) => path.join(repoCacheRoot, DIFFS_DIR);
const resolveManifestPath = (repoCacheRoot) => path.join(resolveDiffsRoot(repoCacheRoot), 'manifest.json');
const resolveDiffDir = (repoCacheRoot, diffId) => path.join(resolveDiffsRoot(repoCacheRoot), diffId);
const resolveInputsPath = (repoCacheRoot, diffId) => path.join(resolveDiffDir(repoCacheRoot, diffId), 'inputs.json');
const resolveSummaryPath = (repoCacheRoot, diffId) => path.join(resolveDiffDir(repoCacheRoot, diffId), 'summary.json');

const ensureDiffId = (diffId) => {
  ensureRegistryId(diffId, DIFF_ID_RE, `Invalid diff id: ${diffId}`);
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
      next.indexRootRef = normalizeRegistryRelativePath(value, 'indexRootRef');
    }
  }
  return next;
};

const sanitizeDiffManifest = (manifest, options) => {
  const next = deepCloneRegistryJson(manifest);
  if (isObject(next.diffs)) {
    for (const entry of Object.values(next.diffs)) {
      if (!isObject(entry)) continue;
      if (typeof entry.summaryPath === 'string') {
        entry.summaryPath = normalizeRegistryRelativePath(entry.summaryPath, 'summaryPath');
      }
      if (typeof entry.eventsPath === 'string') {
        entry.eventsPath = normalizeRegistryRelativePath(entry.eventsPath, 'eventsPath');
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
  const next = deepCloneRegistryJson(inputs);
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
  const next = deepCloneRegistryJson(summary);
  if (Object.prototype.hasOwnProperty.call(next, 'from')) {
    next.from = sanitizeDiffEndpoint(next.from, options);
  }
  if (Object.prototype.hasOwnProperty.call(next, 'to')) {
    next.to = sanitizeDiffEndpoint(next.to, options);
  }
  assertNoAbsolutePathLeak(next);
  return next;
};

const withIndexLock = async (repoCacheRoot, options, worker) => (
  withRegistryLock({
    repoCacheRoot,
    domain: 'diffs',
    options,
    lockHeldMessage: 'Diff registry lock held; unable to write diff registry.',
    worker
  })
);

export const createEmptyDiffsManifest = () => ({
  version: 1,
  updatedAt: null,
  diffs: {}
});

export const loadDiffsManifest = (repoCacheRoot) => (
  readRegistryJsonObject(resolveManifestPath(repoCacheRoot), createEmptyDiffsManifest())
);

export const loadDiffInputs = (repoCacheRoot, diffId) => {
  ensureDiffId(diffId);
  return readRegistryJsonObject(resolveInputsPath(repoCacheRoot, diffId), null);
};

export const loadDiffSummary = (repoCacheRoot, diffId) => {
  ensureDiffId(diffId);
  return readRegistryJsonObject(resolveSummaryPath(repoCacheRoot, diffId), null);
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
    await writeRegistryStableJson(manifestPath, sanitized);
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
    await writeRegistryStableJson(filePath, sanitized);
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
    await writeRegistryStableJson(filePath, sanitized);
    return filePath;
  });
};
