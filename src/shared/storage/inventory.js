import fs from 'node:fs/promises';
import path from 'node:path';
import { assertNoSymlinkPath } from '../contained-file.js';
import { CACHE_OWNER_FILE } from '../cache-deletion.js';
import { readVerifiedContainedFile } from '../contained-file.js';
import { inspectStorageRootFailure } from './root-availability.js';
import { getStorageDirectorySession, withStorageDirectory } from './directory.js';
import { describeStorageFailure } from './failure-observation.js';
import { createStorageInspectionAdmission } from './inspection-admission.js';

const failure = (location, error) => ({ path: location,
  ...describeStorageFailure(error, { phase: 'storage-inventory', defaultCode: 'ERR_STORAGE_SCAN' }) });
export const storageFileIdentity = stat => ({ dev: String(stat.dev), ino: String(stat.ino),
  size: Number(stat.size), mtimeMs: Number(stat.mtimeMs), ctimeMs: Number(stat.ctimeMs),
  mtimeNs: String(stat.mtimeNs ?? stat.mtimeMs), ctimeNs: String(stat.ctimeNs ?? stat.ctimeMs),
  mode: Number(stat.mode), nlink: Number(stat.nlink) });
export const sameStorageFileIdentity = (left, right) => left && right
  && ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'mode', 'nlink'].every(key => left[key] === right[key]);

export const storageAllocatedBytes = stat => {
  // Supported Node/libuv reports kernel per-file allocation in 512-byte units
  // on Windows too. This is not logical length or proof of freed/shared blocks.
  // Preserve exact arithmetic before crossing the JSON number boundary.
  const value = stat.blocks;
  const blocks = typeof value === 'bigint' ? value
    : Number.isSafeInteger(value) ? BigInt(value) : null;
  if (blocks === null || blocks < 0n) return null;
  const bytes = blocks * 512n;
  return bytes <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(bytes) : null;
};
const physicalKey = stat => String(stat.ino) !== '0' ? `${stat.dev}:${stat.ino}` : null;
const exactSum = values => {
  if (values.some(value => !Number.isSafeInteger(value) || value < 0)) return null;
  const sum = values.reduce((total, value) => total + BigInt(value), 0n);
  return sum <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(sum) : null;
};

export const inspectStorageOwnership = async (root, { check = () => {}, signal = null } = {}) => {
  check();
  const marker = path.join(root, CACHE_OWNER_FILE);
  try {
    const { buffer } = await readVerifiedContainedFile(path.parse(root).root, marker, { maxBytes: 64 * 1024, signal });
    check();
    const record = JSON.parse(buffer.toString('utf8'));
    if (record?.owner !== 'pairofcleats' || record.layoutVersion !== 1) {
      return { status: 'incompatible', marker, record: null, deletionAuthority: false };
    }
    return { status: 'marked', marker, record, deletionAuthority: false };
  } catch (error) {
    const diagnostic = failure(marker, error);
    check();
    return { status: diagnostic.code === 'ENOENT' ? 'unmarked' : 'unreadable', marker,
      error: diagnostic, deletionAuthority: false };
  }
};

/** Read-only bounded accounting. Unknown allocated/reclaimable bytes remain null. */
export const inspectStorageInventory = async ({ roots, maxEntries = 100000, maxDurationMs = 10000,
  includeFiles = false, signal = null, now = Date.now } = {}) => {
  if (!Array.isArray(roots) || roots.length > 1024 || !Number.isSafeInteger(maxEntries) || maxEntries < 1
    || !Number.isSafeInteger(maxDurationMs) || maxDurationMs < 1) throw new TypeError('Invalid bounded storage scan.');
  const admission = createStorageInspectionAdmission(maxDurationMs, signal, now), started = admission.started;
  const checks = { check: admission.check, signal, stop: admission.stop };
  const uniqueFiles = new Map();
  const items = [];
  const errors = [];
  let visitedEntries = 0;
  const shouldStop = () => {
    try {
      admission.check();
      if (visitedEntries >= maxEntries) admission.stopFor('entry-budget');
      return false;
    } catch (error) { if (!admission.isStop(error)) throw error; return true; }
  };
  const unknown = item => { item.complete = false; item.logicalBytes = null; item.allocatedBytes = null;
    item.physicalBytesKnown = false; item.physicalIdentityKnown = false; };
  for (const input of roots) {
    const root = path.resolve(input.path || input.resolvedPath);
    const item = { id: input.id || input.category, category: input.category, path: root,
      retention: input.retention || 'unknown', source: input.source || null, repoId: input.repoId || null,
      status: 'registered', complete: false, logicalBytes: 0, allocatedBytes: 0,
      physicalBytesKnown: true, physicalIdentityKnown: true, filesCount: 0, directoriesCount: 0,
      lastUse: { timestamp: null, provenance: 'unknown' }, reclaimableBytes: null,
      ownership: null, identity: null, errors: [], ...(includeFiles ? { files: [], directories: [] } : {}) };
    items.push(item);
    if (shouldStop()) { item.status = 'unscanned'; unknown(item); continue; }
    try {
      // Reject ancestor links, including junctions; inspect never traverses them.
      assertNoSymlinkPath(path.parse(root).root, root);
      admission.check();
      const stat = await fs.lstat(root, { bigint: true });
      admission.check();
      item.identity = storageFileIdentity(stat);
      item.ownership = stat.isDirectory() ? await inspectStorageOwnership(root, checks) : null;
      admission.check();
    } catch (error) {
      if (admission.isStop(error)) { item.status = 'unscanned'; unknown(item); continue; }
      const diagnostic = failure(root, error);
      try {
        Object.assign(item, await inspectStorageRootFailure(root, error, checks));
        admission.check();
      } catch (inspection) {
        if (!admission.isStop(inspection)) throw inspection;
        item.status = 'unscanned'; item.complete = false;
      }
      if (!item.complete) unknown(item);
      item.errors.push(diagnostic);
      if (!item.complete) errors.push(...item.errors);
      continue;
    }
    const stack = [root];
    const rootFiles = new Set();
    const observedDirectories = [];
    while (stack.length && !shouldStop()) {
      const current = stack.pop();
      visitedEntries += 1;
      try {
        assertNoSymlinkPath(root, current);
        admission.check();
        const stat = await fs.lstat(current, { bigint: true });
        admission.check();
        if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
          throw Object.assign(new Error('Nonordinary storage entry is report-only.'), { code: 'ERR_STORAGE_ENTRY_TYPE' });
        }
        if (stat.isDirectory()) {
          item.directoriesCount += 1;
          observedDirectories.push({ path: current, identity: storageFileIdentity(stat) });
          if (includeFiles) item.directories.push({ relativePath: path.relative(root, current), identity: storageFileIdentity(stat) });
          await withStorageDirectory(current, async directory => {
            while (!shouldStop()) {
              const entry = await directory.read();
              admission.check();
              if (!entry) break;
              // Bound the pending frontier as well as the number processed.
              if (stack.length + visitedEntries >= maxEntries) admission.stopFor('entry-budget');
              stack.push(path.join(current, entry.name));
            }
          });
        } else {
          if (!Number.isSafeInteger(Number(stat.size))) throw new Error('Storage file size exceeds exact accounting range.');
          item.filesCount += 1;
          item.logicalBytes += Number(stat.size);
          if (!Number.isSafeInteger(item.logicalBytes)) throw new Error('Storage logical byte sum exceeds exact accounting range.');
          const bytes = storageAllocatedBytes(stat);
          const key = physicalKey(stat);
          if (bytes === null || key === null) item.physicalBytesKnown = false;
          if (key === null) item.physicalIdentityKnown = false;
          if (!key || !rootFiles.has(key)) item.allocatedBytes += bytes || 0;
          if (!Number.isSafeInteger(item.allocatedBytes)) throw new Error('Storage allocation sum exceeds exact accounting range.');
          if (key) {
            rootFiles.add(key);
            const existing = uniqueFiles.get(key);
            if (existing) {
              if (!sameStorageFileIdentity(existing.identity, storageFileIdentity(stat)) || existing.allocatedBytes !== bytes) {
                throw Object.assign(new Error('A shared physical file changed during storage inventory.'), { code: 'ERR_STORAGE_SCAN_CHANGED' });
              }
              existing.paths.add(current);
              existing.attribution.add(item.id);
            } else uniqueFiles.set(key, { size: Number(stat.size), allocatedBytes: bytes,
              paths: new Set([current]), attribution: new Set([item.id]), nlink: Number(stat.nlink), identity: storageFileIdentity(stat) });
          }
          if (includeFiles) item.files.push({ relativePath: path.relative(root, current),
            identity: storageFileIdentity(stat), allocatedBytes: bytes, physicalKey: key });
        }
      } catch (error) {
        if (admission.isStop(error)) break;
        if (getStorageDirectorySession(error)) throw error;
        item.errors.push(failure(current, error));
      }
    }
    for (const directory of observedDirectories) {
      try {
        admission.check();
        assertNoSymlinkPath(root, directory.path);
        admission.check();
        const current = storageFileIdentity(await fs.lstat(directory.path, { bigint: true }));
        admission.check();
        if (!sameStorageFileIdentity(directory.identity, current)) throw Object.assign(new Error('Storage directory membership changed during inventory.'), { code: 'ERR_STORAGE_SCAN_CHANGED' });
      } catch (error) { if (admission.isStop(error)) break; item.errors.push(failure(directory.path, error)); }
    }
    try { admission.check(); } catch (error) { if (!admission.isStop(error)) throw error; }
    item.complete = !admission.reason && !item.errors.length;
    item.status = item.complete ? 'scanned' : 'incomplete';
    if (!item.physicalBytesKnown) item.allocatedBytes = null;
    if (includeFiles) item.files.sort((a, b) => a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0);
    errors.push(...item.errors);
  }
  try { admission.check(); } catch (error) { if (!admission.isStop(error)) throw error; }
  const physical = [...uniqueFiles.values()];
  const complete = !admission.reason && items.every(item => item.complete);
  return { schemaVersion: 1, startedAt: new Date(started).toISOString(),
    finishedAt: new Date(now()).toISOString(), scanMode: 'exact-bounded', complete,
    stopReason: admission.reason, visitedEntries, limits: { maxEntries, maxDurationMs }, items, errors,
    consistency: 'observed-enumeration-with-directory-revalidation; not-a-filesystem-snapshot',
    totals: {
      logicalAttributedBytes: exactSum(items.map(item => item.logicalBytes)),
      uniqueLogicalBytes: complete && items.every(item => item.physicalIdentityKnown)
        ? exactSum(physical.map(file => file.size)) : null,
      uniqueAllocatedBytes: complete && items.every(item => item.physicalBytesKnown)
        ? exactSum(physical.map(file => file.allocatedBytes)) : null,
      uniqueFiles: physical.length, reclaimableBytes: null,
      accounting: complete ? 'observed-files-only' : 'incomplete-observed-files-only',
      deletedButOpenBytes: null, compressedSparseBytes: 'platform-stat-dependent'
    },
    physicalFiles: physical.map(file => ({ ...file, paths: [...file.paths].sort(), attribution: [...file.attribution].sort() })) };
};
