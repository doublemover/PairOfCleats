import fs from 'node:fs/promises';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { Packr, Unpackr } from 'msgpackr';
import { sha1, checksumString } from './hash.js';
import { estimateJsonBytes } from './cache.js';
import { stableStringify } from './stable-json.js';
import { writeJsonObjectFile } from './json-stream.js';

const BUNDLE_FORMAT_TAG = 'pairofcleats.bundle';
const BUNDLE_VERSION = 1;
const MSGPACK_EXTENSIONS = new Set(['.mpk', '.msgpack', '.msgpackr']);
const MAX_BUNDLE_CHECKSUM_BYTES = 16 * 1024 * 1024;
const MAX_BUNDLE_BYTES = 256 * 1024 * 1024;
const BUNDLE_PATCH_FORMAT_TAG = 'pairofcleats.bundle.patch';
const BUNDLE_PATCH_VERSION = 1;
const BUNDLE_PATCH_SUFFIX = '.patch.jsonl';
const MAX_BUNDLE_PATCH_BYTES = 8 * 1024 * 1024;
const MAX_BUNDLE_PATCH_ENTRIES = 64;
const MAX_BUNDLE_PATCH_ENTRY_BYTES = 2 * 1024 * 1024;
const BUNDLE_WORKER_OFFLOAD_THRESHOLD_BYTES = 4 * 1024 * 1024;
const BUNDLE_WORKER_MAX_PAYLOAD_BYTES = 32 * 1024 * 1024;
const BUNDLE_WORKER_TIMEOUT_MS = 15000;
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
const BUNDLE_PATCH_FIELD_KEY_SET = new Set(BUNDLE_PATCH_FIELD_KEYS);

const packr = new Packr({ useRecords: false, structuredClone: true });
const unpackr = new Unpackr({ useRecords: false });
const bundleTransformWorkerUrl = new URL('./workers/bundle-transform-worker.js', import.meta.url);

const isPlainObject = (value) => !!value && typeof value === 'object' && value.constructor === Object;

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

const checksumBundlePayload = async (payload) => {
  const estimate = estimatePayloadBytes(payload);
  if (estimate && estimate > MAX_BUNDLE_CHECKSUM_BYTES) return null;
  if (shouldOffloadBundleTransform(estimate)) {
    const workerResult = await runBundleTransformWorker({
      operation: 'normalize-checksum',
      payload: { bundle: payload }
    });
    if (workerResult.ok) {
      const checksum = workerResult.result?.checksum;
      if (checksum && typeof checksum === 'object') return checksum;
    }
  }
  return checksumString(stableStringify(payload));
};

const estimatePayloadBytes = (value) => {
  const estimate = estimateJsonBytes(value);
  if (!Number.isFinite(estimate) || estimate <= 0) return 0;
  return Math.floor(estimate);
};

const shouldOffloadBundleTransform = (payloadBytes) => Number.isFinite(payloadBytes)
  && payloadBytes >= BUNDLE_WORKER_OFFLOAD_THRESHOLD_BYTES
  && payloadBytes <= BUNDLE_WORKER_MAX_PAYLOAD_BYTES;

const runBundleTransformWorker = ({ operation, payload, timeoutMs = BUNDLE_WORKER_TIMEOUT_MS }) => (
  new Promise((resolve) => {
    const worker = new Worker(bundleTransformWorkerUrl, {
      workerData: { operation, payload },
      type: 'module'
    });
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
      worker.terminate().catch(() => {});
    };
    const timer = setTimeout(() => {
      settle({ ok: false, reason: 'timeout' });
    }, Math.max(500, Math.floor(Number(timeoutMs) || BUNDLE_WORKER_TIMEOUT_MS)));
    timer.unref?.();
    worker.once('message', (message) => {
      if (message?.ok === true) {
        settle({ ok: true, result: message.result });
        return;
      }
      settle({ ok: false, reason: message?.error || 'worker-error' });
    });
    worker.once('error', (err) => {
      settle({ ok: false, reason: err?.message || String(err) });
    });
    worker.once('exit', (code) => {
      if (settled) return;
      if (code === 0) {
        settle({ ok: false, reason: 'missing-worker-result' });
        return;
      }
      settle({ ok: false, reason: `worker-exit-${code}` });
    });
  })
);

const clearBundlePatchFile = async (bundlePath) => {
  try {
    await fs.rm(resolveBundlePatchPath(bundlePath), { force: true });
  } catch {}
};

const stableEquals = (left, right) => {
  if (left === right) return true;
  try {
    return stableStringify(left ?? null) === stableStringify(right ?? null);
  } catch {
    return false;
  }
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
    format: BUNDLE_PATCH_FORMAT_TAG,
    version: BUNDLE_PATCH_VERSION,
    chunks: chunks || null,
    set: setCount > 0 ? set : null
  };
};

const buildBundlePatchAsync = async ({ previousBundle, nextBundle }) => {
  const payload = { previousBundle, nextBundle };
  const payloadBytes = estimatePayloadBytes(payload);
  if (shouldOffloadBundleTransform(payloadBytes)) {
    const workerResult = await runBundleTransformWorker({
      operation: 'build-patch',
      payload
    });
    if (workerResult.ok) {
      const patch = workerResult.result;
      if (!patch) return null;
      return {
        format: BUNDLE_PATCH_FORMAT_TAG,
        version: BUNDLE_PATCH_VERSION,
        chunks: patch.chunks || null,
        set: patch.set || null
      };
    }
  }
  return buildBundlePatch({ previousBundle, nextBundle });
};

const validateBundlePatch = (patch) => {
  if (!isPlainObject(patch)) return { ok: false, reason: 'invalid patch envelope' };
  if (patch.format !== BUNDLE_PATCH_FORMAT_TAG || patch.version !== BUNDLE_PATCH_VERSION) {
    return { ok: false, reason: 'unsupported patch envelope' };
  }
  const keys = Object.keys(patch);
  for (const key of keys) {
    if (key !== 'format' && key !== 'version' && key !== 'chunks' && key !== 'set') {
      return { ok: false, reason: 'invalid patch envelope' };
    }
  }
  if (patch.chunks != null) {
    if (!isPlainObject(patch.chunks)) return { ok: false, reason: 'invalid chunk patch' };
    const chunkKeys = Object.keys(patch.chunks);
    for (const key of chunkKeys) {
      if (key !== 'start' && key !== 'deleteCount' && key !== 'items') {
        return { ok: false, reason: 'invalid chunk patch' };
      }
    }
    const start = Number(patch.chunks.start);
    const deleteCount = Number(patch.chunks.deleteCount);
    if (!Number.isInteger(start) || start < 0 || !Number.isInteger(deleteCount) || deleteCount < 0) {
      return { ok: false, reason: 'invalid chunk patch' };
    }
    if (!Array.isArray(patch.chunks.items)) return { ok: false, reason: 'invalid chunk patch' };
  }
  if (patch.set != null) {
    if (!isPlainObject(patch.set)) return { ok: false, reason: 'invalid patch set' };
    for (const key of Object.keys(patch.set)) {
      if (!BUNDLE_PATCH_FIELD_KEY_SET.has(key)) return { ok: false, reason: 'invalid patch set' };
    }
  }
  if (patch.chunks == null && patch.set == null) {
    return { ok: false, reason: 'invalid patch payload' };
  }
  return { ok: true, reason: null };
};

const applyBundlePatch = ({ bundle, patch }) => {
  const result = validateBundlePatch(patch);
  if (!result.ok) {
    throw new Error(result.reason || 'invalid bundle patch');
  }
  const next = isPlainObject(bundle) ? { ...bundle } : {};
  if (isPlainObject(patch.set)) {
    for (const key of Object.keys(patch.set)) {
      next[key] = patch.set[key];
    }
  }
  if (isPlainObject(patch.chunks)) {
    const base = Array.isArray(next.chunks) ? next.chunks : [];
    const start = Math.max(0, Math.floor(Number(patch.chunks.start)));
    const deleteCount = Math.max(0, Math.floor(Number(patch.chunks.deleteCount)));
    if (start > base.length || (start + deleteCount) > base.length) {
      throw new Error('invalid patch chunk range');
    }
    next.chunks = base.slice(0, start)
      .concat(Array.isArray(patch.chunks.items) ? patch.chunks.items : [])
      .concat(base.slice(start + deleteCount));
  }
  return next;
};

const countPatchEntries = (raw) => {
  if (!raw || typeof raw !== 'string') return 0;
  let count = 0;
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    if (line.trim()) count += 1;
  }
  return count;
};

const readBundlePatches = async (bundlePath) => {
  const patchPath = resolveBundlePatchPath(bundlePath);
  let stat = null;
  try {
    stat = await fs.stat(patchPath);
  } catch {
    return { ok: true, patches: [] };
  }
  if (stat.size > MAX_BUNDLE_PATCH_BYTES) {
    return { ok: false, reason: 'bundle patch too large' };
  }
  let raw = '';
  try {
    raw = await fs.readFile(patchPath, 'utf8');
  } catch {
    return { ok: false, reason: 'failed to read bundle patch' };
  }
  const entryCount = countPatchEntries(raw);
  if (entryCount > MAX_BUNDLE_PATCH_ENTRIES) {
    return { ok: false, reason: 'bundle patch entry limit exceeded' };
  }
  if (!entryCount) return { ok: true, patches: [] };
  const patches = [];
  for (const line of raw.split(/\r?\n/)) {
    const text = line.trim();
    if (!text) continue;
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, reason: 'invalid bundle patch' };
    }
    const validation = validateBundlePatch(parsed);
    if (!validation.ok) {
      return { ok: false, reason: validation.reason || 'invalid bundle patch' };
    }
    patches.push(parsed);
  }
  return { ok: true, patches };
};

export function normalizeBundleFormat(raw) {
  if (typeof raw !== 'string') return 'json';
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'msgpack' || normalized === 'msgpackr' || normalized === 'mpk') {
    return 'msgpack';
  }
  return 'json';
}

export function resolveBundleFilename(relKey, format) {
  const ext = format === 'msgpack' ? 'mpk' : 'json';
  return `${sha1(relKey)}.${ext}`;
}

export function resolveBundleShardFilename(relKey, format, shardIndex = 0) {
  const baseName = resolveBundleFilename(relKey, format);
  const index = Number.isFinite(Number(shardIndex))
    ? Math.max(0, Math.floor(Number(shardIndex)))
    : 0;
  if (index <= 0) return baseName;
  const parsed = path.parse(baseName);
  return `${parsed.name}.part${String(index).padStart(4, '0')}${parsed.ext}`;
}

export function resolveManifestBundleNames(entry) {
  if (!entry || typeof entry !== 'object') return [];
  const legacyBundle = typeof entry.bundle === 'string'
    ? entry.bundle.trim()
    : '';
  const rawBundleNames = Array.isArray(entry.bundles) && entry.bundles.length
    ? entry.bundles
    : (legacyBundle ? [legacyBundle] : []);
  if (!rawBundleNames.length) return [];
  const names = [];
  const seen = new Set();
  for (const value of rawBundleNames) {
    if (typeof value !== 'string') return [];
    const name = value.trim();
    if (!name) return [];
    if (name.includes('/') || name.includes('\\')) return [];
    if (seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

export function resolveBundleFormatFromName(bundleName, fallback = 'json') {
  if (typeof bundleName !== 'string' || !bundleName) return fallback;
  const ext = path.extname(bundleName).toLowerCase();
  return MSGPACK_EXTENSIONS.has(ext) ? 'msgpack' : 'json';
}

export function resolveBundlePatchPath(bundlePath) {
  return `${bundlePath}${BUNDLE_PATCH_SUFFIX}`;
}

export async function writeBundlePatch({
  bundlePath,
  previousBundle,
  nextBundle,
  format = 'json'
}) {
  const resolvedFormat = normalizeBundleFormat(format);
  if (resolvedFormat !== 'json') {
    return { applied: false, reason: 'unsupported-format' };
  }
  const patch = await buildBundlePatchAsync({ previousBundle, nextBundle });
  if (!patch) return { applied: false, reason: 'no-changes' };
  const serialized = `${JSON.stringify(patch)}\n`;
  const bytes = Buffer.byteLength(serialized, 'utf8');
  if (!Number.isFinite(bytes) || bytes <= 0 || bytes > MAX_BUNDLE_PATCH_ENTRY_BYTES) {
    return { applied: false, reason: 'patch-entry-too-large' };
  }
  const patchPath = resolveBundlePatchPath(bundlePath);
  let existingBytes = 0;
  let existingEntries = 0;
  try {
    const stat = await fs.stat(patchPath);
    existingBytes = stat.size;
    if (existingBytes > 0) {
      const raw = await fs.readFile(patchPath, 'utf8');
      existingEntries = countPatchEntries(raw);
    }
  } catch {}
  if ((existingBytes + bytes) > MAX_BUNDLE_PATCH_BYTES) {
    return { applied: false, reason: 'patch-file-too-large' };
  }
  if (existingEntries >= MAX_BUNDLE_PATCH_ENTRIES) {
    return { applied: false, reason: 'patch-entry-limit' };
  }
  await fs.appendFile(patchPath, serialized, 'utf8');
  const chunkPatch = patch.chunks;
  const operation = chunkPatch
    ? ((chunkPatch.deleteCount === 0 && chunkPatch.start >= (Array.isArray(previousBundle?.chunks) ? previousBundle.chunks.length : 0))
      ? 'append'
      : 'replace')
    : 'set';
  return {
    applied: true,
    reason: null,
    patchPath,
    bytes,
    operation
  };
}

export async function writeBundleFile({ bundlePath, bundle, format = 'json' }) {
  const resolvedFormat = normalizeBundleFormat(format);
  if (resolvedFormat === 'msgpack') {
    const bundleEstimate = estimatePayloadBytes(bundle);
    let normalized = null;
    let checksum = null;
    if (shouldOffloadBundleTransform(bundleEstimate)) {
      const workerResult = await runBundleTransformWorker({
        operation: 'normalize-checksum',
        payload: { bundle }
      });
      if (workerResult.ok && workerResult.result) {
        normalized = workerResult.result.normalized;
        checksum = workerResult.result.checksum || null;
      }
    }
    if (!normalized) {
      normalized = normalizeBundlePayload(bundle);
      checksum = await checksumBundlePayload(normalized);
    }
    const envelope = {
      format: BUNDLE_FORMAT_TAG,
      version: BUNDLE_VERSION,
      checksum: checksum ? { algo: checksum.algo, value: checksum.value } : null,
      payload: normalized
    };
    const encoded = packr.pack(envelope);
    await fs.writeFile(bundlePath, Buffer.from(encoded));
    await clearBundlePatchFile(bundlePath);
    return {
      format: resolvedFormat,
      checksum: checksum?.value ?? null,
      checksumAlgo: checksum?.algo ?? null
    };
  }
  await writeJsonObjectFile(bundlePath, { fields: bundle, trailingNewline: true });
  await clearBundlePatchFile(bundlePath);
  return { format: resolvedFormat, checksum: null, checksumAlgo: null };
}

export async function readBundleFile(bundlePath, { format = null, maxBytes = MAX_BUNDLE_BYTES } = {}) {
  const stat = await fs.stat(bundlePath);
  if (Number.isFinite(maxBytes) && maxBytes > 0 && stat.size > maxBytes) {
    return { ok: false, reason: 'bundle too large' };
  }
  const resolvedFormat = format || resolveBundleFormatFromName(bundlePath);
  if (resolvedFormat === 'msgpack') {
    const buffer = await fs.readFile(bundlePath);
    const envelope = unpackr.unpack(buffer);
    if (!envelope || typeof envelope !== 'object') {
      return { ok: false, reason: 'invalid bundle envelope' };
    }
    if (envelope.format !== BUNDLE_FORMAT_TAG || envelope.version !== BUNDLE_VERSION) {
      return { ok: false, reason: 'unsupported bundle envelope' };
    }
    const payload = envelope.payload;
    if (!payload || !Array.isArray(payload.chunks)) {
      return { ok: false, reason: 'invalid bundle payload' };
    }
    const checksum = envelope.checksum?.value;
    if (checksum) {
      const normalized = normalizeBundlePayload(payload);
      const estimate = estimateJsonBytes(normalized);
      if (estimate && estimate > MAX_BUNDLE_CHECKSUM_BYTES) {
        return { ok: true, bundle: normalized };
      }
      if (envelope.checksum?.algo === 'xxh64') {
        const expected = await checksumBundlePayload(normalized);
        if (!expected || expected.value !== checksum) {
          return { ok: false, reason: 'bundle checksum mismatch' };
        }
        return { ok: true, bundle: normalized };
      }
      if (envelope.checksum?.algo === 'sha1') {
        const expected = sha1(stableStringify(normalized));
        if (expected !== checksum) {
          return { ok: false, reason: 'bundle checksum mismatch' };
        }
        return { ok: true, bundle: normalized };
      }
    }
    return { ok: true, bundle: payload };
  }
  const raw = await fs.readFile(bundlePath, 'utf8');
  let bundle = null;
  try {
    bundle = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'invalid bundle' };
  }
  if (!bundle || !Array.isArray(bundle.chunks)) {
    return { ok: false, reason: 'invalid bundle' };
  }
  const patches = await readBundlePatches(bundlePath);
  if (!patches.ok) {
    return { ok: false, reason: 'invalid bundle patch' };
  }
  if (patches.patches.length) {
    let patchedBundle = bundle;
    try {
      for (const patch of patches.patches) {
        patchedBundle = applyBundlePatch({ bundle: patchedBundle, patch });
      }
    } catch {
      return { ok: false, reason: 'invalid bundle patch' };
    }
    if (!patchedBundle || !Array.isArray(patchedBundle.chunks)) {
      return { ok: false, reason: 'invalid bundle patch' };
    }
    bundle = patchedBundle;
  }
  return { ok: true, bundle };
}
