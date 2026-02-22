import { parentPort, workerData } from 'node:worker_threads';
import { checksumString } from '../hash.js';
import { estimateJsonBytes } from '../cache.js';
import { stableStringify } from '../stable-json.js';

const MAX_BUNDLE_CHECKSUM_BYTES = 16 * 1024 * 1024;
const BUNDLE_PATCH_FIELD_KEYS = [
  'file',
  'hash',
  'mtimeMs',
  'size',
  'fileRelations',
  'vfsManifestRows',
  'encoding',
  'encodingFallback',
  'encodingConfidence'
];

const stableEquals = (left, right) => {
  if (left === right) return true;
  try {
    return stableStringify(left ?? null) === stableStringify(right ?? null);
  } catch {
    return false;
  }
};

const normalizeBundlePayload = (value) => {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeBundlePayload(entry));
  }
  if (!value || typeof value !== 'object' || value.constructor !== Object) {
    return value;
  }
  const out = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = normalizeBundlePayload(value[key]);
  }
  return out;
};

const buildChunkPatch = (previousChunks, nextChunks) => {
  const before = Array.isArray(previousChunks) ? previousChunks : [];
  const after = Array.isArray(nextChunks) ? nextChunks : [];
  const minLength = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < minLength && stableEquals(before[prefix], after[prefix])) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < (minLength - prefix)
    && stableEquals(
      before[before.length - 1 - suffix],
      after[after.length - 1 - suffix]
    )
  ) {
    suffix += 1;
  }
  const deleteCount = Math.max(0, before.length - prefix - suffix);
  const insertEnd = Math.max(prefix, after.length - suffix);
  const items = after.slice(prefix, insertEnd);
  if (deleteCount === 0 && items.length === 0) return null;
  return {
    start: prefix,
    deleteCount,
    items
  };
};

const buildBundlePatch = ({ previousBundle, nextBundle }) => {
  if (!previousBundle || !nextBundle) return null;
  const set = {};
  let setCount = 0;
  for (const key of BUNDLE_PATCH_FIELD_KEYS) {
    const before = previousBundle[key];
    const after = nextBundle[key];
    if (stableEquals(before, after)) continue;
    set[key] = after ?? null;
    setCount += 1;
  }
  const chunks = buildChunkPatch(previousBundle.chunks, nextBundle.chunks);
  if (!chunks && setCount === 0) return null;
  return {
    chunks: chunks || null,
    set: setCount > 0 ? set : null
  };
};

const runNormalizeChecksum = (payload) => {
  const normalized = normalizeBundlePayload(payload?.bundle ?? null);
  const estimate = estimateJsonBytes(normalized);
  const checksum = estimate && estimate > MAX_BUNDLE_CHECKSUM_BYTES
    ? null
    : checksumString(stableStringify(normalized));
  return { normalized, checksum };
};

const runBuildPatch = (payload) => buildBundlePatch({
  previousBundle: payload?.previousBundle ?? null,
  nextBundle: payload?.nextBundle ?? null
});

const main = async () => {
  try {
    const operation = typeof workerData?.operation === 'string'
      ? workerData.operation
      : '';
    let result = null;
    if (operation === 'normalize-checksum') {
      result = runNormalizeChecksum(workerData.payload || {});
    } else if (operation === 'build-patch') {
      result = runBuildPatch(workerData.payload || {});
    } else {
      throw new Error(`unsupported bundle worker operation: ${operation || 'unknown'}`);
    }
    parentPort?.postMessage({ ok: true, result });
  } catch (err) {
    parentPort?.postMessage({
      ok: false,
      error: err?.message || String(err)
    });
  }
};

await main();
