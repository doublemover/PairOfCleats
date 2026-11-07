import fs from 'node:fs';
import path from 'node:path';
import { getCacheRoot } from '../../../shared/cache-roots.js';
import { isTestingEnv } from '../../../shared/env/testing.js';
import { writeJsonLinesFile } from '../../../shared/json-stream/jsonl-write.js';
import { writeJsonObjectFile } from '../../../shared/json-stream/json-writers.js';
import { describeStorageFailure, observeStorageResource } from '../../../shared/storage/failure-observation.js';
import { assertToolingCachePath, ensureToolingCacheDir, readToolingCacheEntry } from '../cache-storage.js';
import { createColdStartEntryOwner, VFS_COLD_METADATA_MAX_BYTES, VFS_COLD_MAX_ENTRIES, VFS_COLD_MAX_ROW_BYTES } from './cold-start-owner.js';
import { readColdStartRows } from './cold-start-rows.js';
import {
  VFS_COLD_START_DATA,
  VFS_COLD_START_DIR,
  VFS_COLD_START_MAX_AGE_DAYS,
  VFS_COLD_START_MAX_BYTES,
  VFS_COLD_START_META,
  VFS_COLD_START_SCHEMA_VERSION
} from './constants.js';

const invalidInput = reason => Object.assign(new Error(`VFS cold cache input rejected: ${reason}.`), {
  code: 'ERR_VFS_COLD_CACHE_INPUT', reason
});
const resolveColdStartConfig = value => {
  if (value === false || value?.enabled === false) return { enabled: false };
  const enabled = typeof value?.enabled === 'boolean' ? value.enabled : true;
  if (!enabled || isTestingEnv() && value?.enabled !== true) return { enabled: false };
  const maxBytes = value?.maxBytes ?? VFS_COLD_START_MAX_BYTES;
  const maxAgeDays = value?.maxAgeDays ?? VFS_COLD_START_MAX_AGE_DAYS;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new TypeError('vfs cold-start maxBytes must be a nonnegative safe integer.');
  if (typeof maxAgeDays !== 'number' || !Number.isFinite(maxAgeDays) || maxAgeDays < 0
    || maxAgeDays * 86400000 > Number.MAX_SAFE_INTEGER) throw new TypeError('vfs cold-start maxAgeDays must be bounded and nonnegative.');
  return { enabled: true, maxBytes, maxAgeDays,
    cacheRoot: typeof value?.cacheRoot === 'string' && value.cacheRoot.trim() ? path.resolve(value.cacheRoot) : getCacheRoot() };
};

const normalizeMaterialization = (value, entry) => {
  if (!value || value.version !== 1 || value.policy !== 'mutable-path-current-descriptor'
    || typeof value.baseDir !== 'string' || value.baseDir.length > VFS_COLD_MAX_ROW_BYTES || !path.isAbsolute(value.baseDir) || value.virtualPath !== entry.virtualPath
    || value.docHash !== entry.docHash || value.sizeBytes !== entry.sizeBytes || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(value.sha256)
    || !['unchanged-opened-file-identity', 'sha256-opened-file-content'].includes(value.verification)
    || !Number.isSafeInteger(value.verificationBytes) || value.verificationBytes < 0 || value.verificationBytes > entry.sizeBytes) return null;
  const identity = {};
  for (const key of ['dev', 'ino', 'size', 'nlink', 'mtimeNs', 'ctimeNs', 'birthtimeNs']) {
    if (typeof value.identity?.[key] !== 'string' || !/^-?[0-9]{1,40}$/u.test(value.identity[key])) return null;
    identity[key] = value.identity[key];
  }
  return Object.freeze({ version: 1, policy: value.policy, baseDir: value.baseDir, virtualPath: entry.virtualPath,
    docHash: entry.docHash, sizeBytes: entry.sizeBytes, sha256: value.sha256, verification: value.verification,
    verificationBytes: value.verificationBytes, identity: Object.freeze(identity) });
};
const normalizeColdStartEntry = (value, fromDisk = false) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || fromDisk && value.schemaVersion !== VFS_COLD_START_SCHEMA_VERSION) return null;
  if (['virtualPath', 'docHash', 'diskPath'].some(key => typeof value[key] !== 'string' || value[key].length > VFS_COLD_MAX_ROW_BYTES)) return null;
  const virtualPath = typeof value.virtualPath === 'string' ? value.virtualPath.trim() : '';
  const docHash = typeof value.docHash === 'string' ? value.docHash.trim() : '';
  const diskPath = typeof value.diskPath === 'string' ? value.diskPath.trim() : '';
  if (!virtualPath || !docHash || !diskPath || !path.isAbsolute(diskPath)
    || !Number.isSafeInteger(value.sizeBytes) || value.sizeBytes < 0) return null;
  const updatedAt = fromDisk ? value.updatedAt : new Date().toISOString();
  if (typeof updatedAt !== 'string' || !Number.isFinite(Date.parse(updatedAt))) return null;
  const entry = { schemaVersion: VFS_COLD_START_SCHEMA_VERSION, virtualPath, docHash, diskPath, sizeBytes: value.sizeBytes, updatedAt };
  const materialization = normalizeMaterialization(value.materialization, entry);
  if (materialization) entry.materialization = materialization;
  return Object.freeze(entry);
};

/** Metadata lookup is advisory. The disk materialization owner independently
 * qualifies current root/content. Live entries, raw input and flush snapshots
 * have separate bounded ownership and observable accounting. */
export const createVfsColdStartCache = async ({ cacheRoot = null, indexSignature = null, manifestHash = null, config = null } = {}) => {
  const resolved = resolveColdStartConfig(config);
  if (!resolved.enabled) return null;
  const resolvedCacheRoot = cacheRoot ? path.resolve(cacheRoot) : resolved.cacheRoot;
  if (!resolvedCacheRoot || !indexSignature || !manifestHash) return null;
  const baseDir = path.join(resolvedCacheRoot, VFS_COLD_START_DIR);
  const metaPath = path.join(baseDir, VFS_COLD_START_META), dataPath = path.join(baseDir, VFS_COLD_START_DATA);
  const counters = { loadStatus: resolved.maxBytes ? 'missing' : 'disabled-budget', loadErrorCode: null,
    cacheFileBytes: 0, loadedInputBytes: 0, loadedRows: 0, loadedEntries: 0, loadedPayloadBytes: 0, loadedMetadataBytes: 0,
    metadataHits: 0, metadataMisses: 0, invalidRows: 0, flushes: 0, flushFailures: 0,
    snapshotEntriesHighWater: 0, snapshotMetadataBytesHighWater: 0 };
  let loading = true, revision = 0n, persistedRevision = 0n, inFlight = null, failedFlush = null;
  const owner = createColdStartEntryOwner({ maxBytes: resolved.maxBytes,
    maxAgeMs: resolved.maxAgeDays > 0 ? resolved.maxAgeDays * 86400000 : null,
    onMutation: () => { if (!loading) revision++; } });
  if (resolved.maxBytes) {
    try {
      const meta = readToolingCacheEntry(metaPath, 65536).payload;
      if (meta?.schemaVersion !== VFS_COLD_START_SCHEMA_VERSION) counters.loadStatus = 'unsupported-version';
      else if (meta.indexSignature !== indexSignature || meta.manifestHash !== manifestHash) counters.loadStatus = 'stale-source';
      else {
        if (!Number.isSafeInteger(meta.entries) || meta.entries < 0 || meta.entries > VFS_COLD_MAX_ENTRIES
          || !Number.isSafeInteger(meta.bytes) || meta.bytes < 0) throw invalidInput('metadata-count');
        let payloadBytes = 0;
        for await (const raw of readColdStartRows(resolvedCacheRoot, dataPath, counters)) {
          const entry = normalizeColdStartEntry(raw, true);
          if (!entry) { counters.invalidRows++; throw invalidInput('row-shape'); }
          payloadBytes += entry.sizeBytes;
          if (!Number.isSafeInteger(payloadBytes)) throw invalidInput('payload-accounting');
          owner.admit(entry);
        }
        if (counters.loadedRows !== meta.entries || payloadBytes !== meta.bytes) throw invalidInput('metadata-row-parity');
        const state = owner.stats();
        counters.loadedEntries = state.entries; counters.loadedPayloadBytes = state.payloadBytes; counters.loadedMetadataBytes = state.metadataBytes;
        counters.loadStatus = state.evictions || state.expired || state.oversized ? 'loaded-compacted' : 'loaded';
      }
    } catch (error) {
      const failure = describeStorageFailure(error, { phase: 'vfs-cold-cache-load' });
      owner.clear(); counters.loadedEntries = 0; counters.loadedPayloadBytes = 0; counters.loadedMetadataBytes = 0;
      counters.loadErrorCode = failure.code; counters.loadStatus = failure.code === 'ENOENT' ? 'missing' : 'rejected-input';
    }
  }
  loading = false;
  const canonical = value => process.platform === 'win32' ? path.toNamespacedPath(path.resolve(value)).toLowerCase() : path.resolve(value);
  const get = ({ virtualPath, docHash, expectedPath = null }) => {
    const entry = virtualPath && docHash ? owner.get(virtualPath) : null;
    if (!entry || entry.docHash !== docHash || expectedPath && canonical(entry.diskPath) !== canonical(expectedPath) || !fs.existsSync(entry.diskPath)) {
      counters.metadataMisses++; return null;
    }
    counters.metadataHits++; return entry.diskPath;
  };
  const set = input => {
    const entry = normalizeColdStartEntry(input);
    if (!entry) { counters.invalidRows++; return false; }
    return owner.admit(entry);
  };
  const publish = async (snapshot, snapshotRevision) => {
    try {
      const checkedDataPath = assertToolingCachePath(dataPath), checkedMetaPath = assertToolingCachePath(metaPath);
      ensureToolingCacheDir(path.dirname(checkedDataPath)); assertToolingCachePath(checkedDataPath);
      await writeJsonLinesFile(checkedDataPath, snapshot.entries, { atomic: true, compression: null });
      assertToolingCachePath(checkedMetaPath);
      await writeJsonObjectFile(checkedMetaPath, { fields: { schemaVersion: VFS_COLD_START_SCHEMA_VERSION,
        indexSignature, manifestHash, createdAt: new Date().toISOString(), entries: snapshot.entries.length,
        bytes: snapshot.payloadBytes, metadataBytes: snapshot.metadataBytes }, atomic: true });
      persistedRevision = snapshotRevision; counters.flushes++;
    } catch (error) {
      counters.flushFailures++; failedFlush = observeStorageResource(error, { phase: 'vfs-cold-cache-publication' }); throw error;
    }
  };
  const flush = async () => {
    failedFlush?.requireSettled(); failedFlush = null;
    owner.size(); const targetRevision = revision;
    while (persistedRevision < targetRevision) {
      if (!inFlight) {
        const snapshot = owner.snapshot(), snapshotRevision = revision;
        counters.snapshotEntriesHighWater = Math.max(counters.snapshotEntriesHighWater, snapshot.entries.length);
        counters.snapshotMetadataBytesHighWater = Math.max(counters.snapshotMetadataBytesHighWater, snapshot.metadataBytes);
        const operation = publish(snapshot, snapshotRevision); inFlight = operation;
        operation.then(() => { if (inFlight === operation) inFlight = null; }, () => { if (inFlight === operation) inFlight = null; });
      }
      await inFlight;
      failedFlush?.requireSettled();
    }
  };
  return { get, set, flush, size: () => owner.size(), stats: () => ({ ...counters, ...owner.stats(),
    revision: String(revision), persistedRevision: String(persistedRevision), flushInFlight: Boolean(inFlight),
    cacheFileMaxBytes: VFS_COLD_METADATA_MAX_BYTES, metadataFileMaxBytes: 65536,
    accounting: 'document-payload-and-serialized-entry-bytes;count-bounded-object-overhead' }) };
};
