import fs from 'node:fs/promises';
import { atomicWriteJson, atomicWriteText } from '../io/atomic-write.js';
import {
  BUNDLE_PATCH_FIELD_KEYS,
  BUNDLE_PATCH_FORMAT_TAG,
  BUNDLE_PATCH_VERSION
} from '../bundle-io-constants.js';
import {
  normalizeBundleFormat,
  resolveBundlePatchLockPath,
  resolveBundlePatchMetaPath,
  resolveBundlePatchPath
} from '../bundle-io-paths.js';
import { estimatePayloadBytes } from '../bundle-io-checksum.js';
import {
  MAX_BUNDLE_PATCH_BYTES,
  MAX_BUNDLE_PATCH_ENTRIES,
  MAX_BUNDLE_PATCH_ENTRY_BYTES
} from '../bundle-contract.js';
import {
  isPlainObject,
  runBundleTransformWorker,
  shouldOffloadBundleTransform,
  writeBundleJsonChecksum
} from './support.js';

const BUNDLE_PATCH_FIELD_KEY_SET = new Set(BUNDLE_PATCH_FIELD_KEYS);
let bundlePatchModulePromise = null;
let fileLockModulePromise = null;

const loadBundlePatchModule = () => {
  if (!bundlePatchModulePromise) {
    bundlePatchModulePromise = import('../bundle-patch.js');
  }
  return bundlePatchModulePromise;
};

const loadFileLockModule = () => {
  fileLockModulePromise ??= import('../locks/file-lock.js');
  return fileLockModulePromise;
};

const buildBundlePatch = async ({ previousBundle, nextBundle }) => {
  const { buildBundlePatchPayload } = await loadBundlePatchModule();
  const payload = buildBundlePatchPayload({ previousBundle, nextBundle });
  if (!payload) return null;
  return {
    format: BUNDLE_PATCH_FORMAT_TAG,
    version: BUNDLE_PATCH_VERSION,
    chunks: payload.chunks || null,
    set: payload.set || null
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
  return await buildBundlePatch({ previousBundle, nextBundle });
};

export const validateBundlePatch = (patch) => {
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

export const applyBundlePatch = ({ bundle, patch }) => {
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

export const readBundlePatches = async (bundlePath) => {
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

const readBundlePatchMeta = async (bundlePath) => {
  const metaPath = resolveBundlePatchMetaPath(bundlePath);
  try {
    const raw = await fs.readFile(metaPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const bytes = Number(parsed.bytes);
    const entries = Number(parsed.entries);
    if (!Number.isFinite(bytes) || bytes < 0 || !Number.isFinite(entries) || entries < 0) {
      return null;
    }
    return {
      bytes: Math.floor(bytes),
      entries: Math.floor(entries)
    };
  } catch {
    return null;
  }
};

const writeBundlePatchMeta = async (bundlePath, { bytes, entries }) => {
  const metaPath = resolveBundlePatchMetaPath(bundlePath);
  await atomicWriteJson(metaPath, {
    version: 1,
    bytes: Math.max(0, Math.floor(Number(bytes) || 0)),
    entries: Math.max(0, Math.floor(Number(entries) || 0)),
    updatedAt: new Date().toISOString()
  }, {
    spaces: 0,
    newline: false
  });
};

const appendSerializedPatchLine = (raw, serialized) => {
  if (!raw) return serialized;
  if (raw.endsWith('\n')) return `${raw}${serialized}`;
  return `${raw}\n${serialized}`;
};

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
  const {
    acquireFileLock,
    releaseFileLockOrThrow
  } = await loadFileLockModule();
  const lock = await acquireFileLock({
    lockPath: resolveBundlePatchLockPath(bundlePath),
    waitMs: 30000,
    pollMs: 25,
    staleMs: 120000,
    forceStaleCleanup: true,
    metadata: { scope: 'bundle-patch-write' }
  });
  if (!lock) {
    return { applied: false, reason: 'patch-lock-timeout' };
  }
  let workerResult = null;
  let workerError = null;
  try {
    let existingBytes = 0;
    let existingEntries = 0;
    let existingRaw = '';
    let stat = null;
    try {
      stat = await fs.stat(patchPath);
    } catch {}
    if (stat && stat.size > 0) {
      const meta = await readBundlePatchMeta(bundlePath);
      if (
        meta
        && Number.isFinite(meta.bytes)
        && Number.isFinite(meta.entries)
        && meta.bytes === stat.size
      ) {
        existingBytes = meta.bytes;
        existingEntries = meta.entries;
      } else {
        existingRaw = await fs.readFile(patchPath, 'utf8');
        existingBytes = Buffer.byteLength(existingRaw, 'utf8');
        existingEntries = countPatchEntries(existingRaw);
      }
    }
    const appendBytes = existingBytes > 0 && !existingRaw
      ? Buffer.byteLength(`\n${serialized}`, 'utf8')
      : bytes;
    if ((existingBytes + appendBytes) > MAX_BUNDLE_PATCH_BYTES) {
      workerResult = { applied: false, reason: 'patch-file-too-large' };
    } else if (existingEntries >= MAX_BUNDLE_PATCH_ENTRIES) {
      workerResult = { applied: false, reason: 'patch-entry-limit' };
    } else {
      if (existingBytes > 0 && !existingRaw) {
        await fs.appendFile(patchPath, `\n${serialized}`, 'utf8');
      } else {
        const nextRaw = appendSerializedPatchLine(existingRaw, serialized);
        await atomicWriteText(patchPath, nextRaw, { newline: false });
      }
      const nextBytes = existingBytes + appendBytes;
      const nextEntries = existingEntries + 1;
      await writeBundlePatchMeta(bundlePath, {
        bytes: nextBytes,
        entries: nextEntries
      });
      await writeBundleJsonChecksum(bundlePath, nextBundle);
      const chunkPatch = patch.chunks;
      const operation = chunkPatch
        ? ((chunkPatch.deleteCount === 0
            && chunkPatch.start >= (Array.isArray(previousBundle?.chunks)
              ? previousBundle.chunks.length
              : 0))
          ? 'append'
          : 'replace')
        : 'set';
      workerResult = {
        applied: true,
        reason: null,
        patchPath,
        bytes,
        operation
      };
    }
  } catch (error) {
    workerError = error;
  }
  await releaseFileLockOrThrow(lock, {
    workerError,
    releaseOptions: { force: true }
  });
  if (workerError) throw workerError;
  return workerResult;
}
