import fs from 'node:fs/promises';
import path from 'node:path';
import { assertNoSymlinkPath } from '../contained-file.js';
import { CACHE_OWNER_FILE } from '../cache-deletion.js';
import { readVerifiedContainedFile } from '../contained-file.js';

const failure = (location, error) => ({ path: location, code: error?.code || 'ERR_STORAGE_SCAN',
  message: error?.message || String(error) });
export const storageFileIdentity = stat => ({ dev: String(stat.dev), ino: String(stat.ino),
  size: Number(stat.size), mtimeMs: Number(stat.mtimeMs), ctimeMs: Number(stat.ctimeMs),
  mtimeNs: String(stat.mtimeNs ?? stat.mtimeMs), ctimeNs: String(stat.ctimeNs ?? stat.ctimeMs),
  mode: Number(stat.mode), nlink: Number(stat.nlink) });
export const sameStorageFileIdentity = (left, right) => left && right
  && ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'mode', 'nlink'].every(key => left[key] === right[key]);

const allocatedBytes = stat => {
  // Node's Windows stat does not establish compressed/sparse allocation.
  if (process.platform === 'win32') return null;
  if (stat.blocks == null) return null;
  const bytes = Number(stat.blocks) * 512;
  return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null;
};
const physicalKey = stat => String(stat.ino) !== '0' ? `${stat.dev}:${stat.ino}` : null;

export const inspectStorageOwnership = async root => {
  const marker = path.join(root, CACHE_OWNER_FILE);
  try {
    const { buffer } = await readVerifiedContainedFile(path.parse(root).root, marker, { maxBytes: 64 * 1024 });
    const record = JSON.parse(buffer.toString('utf8'));
    if (record?.owner !== 'pairofcleats' || record.layoutVersion !== 1) {
      return { status: 'incompatible', marker, record: null, deletionAuthority: false };
    }
    return { status: 'marked', marker, record, deletionAuthority: false };
  } catch (error) {
    return { status: error.code === 'ENOENT' ? 'unmarked' : 'unreadable', marker,
      error: failure(marker, error), deletionAuthority: false };
  }
};

/** Read-only bounded accounting. Unknown allocated/reclaimable bytes remain null. */
export const inspectStorageInventory = async ({ roots, maxEntries = 100000, maxDurationMs = 10000,
  includeFiles = false, signal = null, now = Date.now } = {}) => {
  if (!Array.isArray(roots) || roots.length > 1024 || !Number.isSafeInteger(maxEntries) || maxEntries < 1
    || !Number.isSafeInteger(maxDurationMs) || maxDurationMs < 1) throw new TypeError('Invalid bounded storage scan.');
  const started = now();
  const uniqueFiles = new Map();
  const items = [];
  const errors = [];
  let visitedEntries = 0;
  let stopReason = null;
  const shouldStop = () => {
    if (signal?.aborted) stopReason = 'cancelled';
    else if (visitedEntries >= maxEntries) stopReason = 'entry-budget';
    else if (now() - started >= maxDurationMs) stopReason = 'time-budget';
    return Boolean(stopReason);
  };
  for (const input of roots) {
    const root = path.resolve(input.path || input.resolvedPath);
    const item = { id: input.id || input.category, category: input.category, path: root,
      retention: input.retention || 'unknown', source: input.source || null, repoId: input.repoId || null,
      status: 'registered', complete: false, logicalBytes: 0, allocatedBytes: 0,
      physicalBytesKnown: true, physicalIdentityKnown: true, filesCount: 0, directoriesCount: 0,
      lastUse: { timestamp: null, provenance: 'unknown' }, reclaimableBytes: null,
      ownership: null, identity: null, errors: [], ...(includeFiles ? { files: [], directories: [] } : {}) };
    items.push(item);
    if (shouldStop()) { item.status = 'unscanned'; continue; }
    try {
      // Reject ancestor links, including junctions; inspect never traverses them.
      assertNoSymlinkPath(path.parse(root).root, root);
      const stat = await fs.lstat(root, { bigint: true });
      item.identity = storageFileIdentity(stat);
      item.ownership = stat.isDirectory() ? await inspectStorageOwnership(root) : null;
    } catch (error) {
      item.status = error.code === 'ENOENT' ? 'missing' : 'inaccessible';
      item.complete = error.code === 'ENOENT';
      if (!item.complete) { item.logicalBytes = null; item.allocatedBytes = null; }
      item.errors.push(failure(root, error));
      continue;
    }
    const stack = [root];
    const rootFiles = new Set();
    while (stack.length && !shouldStop()) {
      const current = stack.pop();
      visitedEntries += 1;
      try {
        assertNoSymlinkPath(root, current);
        const stat = await fs.lstat(current, { bigint: true });
        if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
          throw Object.assign(new Error('Nonordinary storage entry is report-only.'), { code: 'ERR_STORAGE_ENTRY_TYPE' });
        }
        if (stat.isDirectory()) {
          item.directoriesCount += 1;
          if (includeFiles) item.directories.push({ relativePath: path.relative(root, current), identity: storageFileIdentity(stat) });
          const directory = await fs.opendir(current);
          try {
            while (!shouldStop()) {
              const entry = await directory.read();
              if (!entry) break;
              // Bound the pending frontier as well as the number processed.
              if (stack.length + visitedEntries >= maxEntries) { stopReason = 'entry-budget'; break; }
              stack.push(path.join(current, entry.name));
            }
          } finally { await directory.close(); }
        } else {
          if (!Number.isSafeInteger(Number(stat.size))) throw new Error('Storage file size exceeds exact accounting range.');
          item.filesCount += 1;
          item.logicalBytes += Number(stat.size);
          const bytes = allocatedBytes(stat);
          const key = physicalKey(stat);
          if (bytes === null || key === null) item.physicalBytesKnown = false;
          if (key === null) item.physicalIdentityKnown = false;
          if (!key || !rootFiles.has(key)) item.allocatedBytes += bytes || 0;
          if (key) {
            rootFiles.add(key);
            const existing = uniqueFiles.get(key);
            if (existing) {
              existing.paths.add(current);
              existing.attribution.add(item.id);
            } else uniqueFiles.set(key, { size: Number(stat.size), allocatedBytes: bytes,
              paths: new Set([current]), attribution: new Set([item.id]), nlink: Number(stat.nlink) });
          }
          if (includeFiles) item.files.push({ relativePath: path.relative(root, current),
            identity: storageFileIdentity(stat), allocatedBytes: bytes, physicalKey: key });
        }
      } catch (error) { item.errors.push(failure(current, error)); }
    }
    item.complete = !stopReason && !item.errors.length;
    item.status = item.complete ? 'scanned' : 'incomplete';
    if (!item.physicalBytesKnown) item.allocatedBytes = null;
    if (includeFiles) item.files.sort((a, b) => a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0);
    errors.push(...item.errors);
  }
  const physical = [...uniqueFiles.values()];
  const complete = !stopReason && items.every(item => item.complete);
  return { schemaVersion: 1, startedAt: new Date(started).toISOString(),
    finishedAt: new Date(now()).toISOString(), scanMode: 'exact-bounded', complete,
    stopReason, visitedEntries, limits: { maxEntries, maxDurationMs }, items, errors,
    totals: {
      logicalAttributedBytes: items.reduce((sum, item) => sum + item.logicalBytes, 0),
      uniqueLogicalBytes: complete && items.every(item => item.physicalIdentityKnown)
        ? physical.reduce((sum, file) => sum + file.size, 0) : null,
      uniqueAllocatedBytes: complete && items.every(item => item.physicalBytesKnown)
        ? physical.reduce((sum, file) => sum + file.allocatedBytes, 0) : null,
      uniqueFiles: physical.length, reclaimableBytes: null,
      accounting: complete ? 'observed-files-only' : 'incomplete-observed-files-only',
      deletedButOpenBytes: null, compressedSparseBytes: 'platform-stat-dependent'
    },
    physicalFiles: physical.map(file => ({ ...file, paths: [...file.paths].sort(), attribution: [...file.attribution].sort() })) };
};
