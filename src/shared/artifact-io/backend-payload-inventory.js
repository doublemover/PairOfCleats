import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { assertNoSymlinkPath, withContainedFile } from '../contained-file.js';
import { throwIfAborted } from '../abort.js';
import { withStorageDirectory } from '../storage/directory.js';

export const BACKEND_INVENTORY_LIMITS = Object.freeze({ entries: 4096, bytes: 512 * 1024, depth: 32, windowBytes: 65536 });
const MAX_FILES = BACKEND_INVENTORY_LIMITS.entries, MAX_INVENTORY_BYTES = BACKEND_INVENTORY_LIMITS.bytes, WINDOW_BYTES = BACKEND_INVENTORY_LIMITS.windowBytes;
const changed = () => Object.assign(new Error('Immutable native backend bytes changed during inventory.'), { code: 'ERR_ANN_REUSE_INTEGRITY' });
const sameStat = (left, right) => ['dev', 'ino', 'mode', 'size', 'mtimeNs', 'ctimeNs'].every(key => left[key] === right[key]);
const stamps = new WeakMap();
export const listBackendPayloadEntries = async (dir, signal, limits = null) => {
  const entryLimit = limits?.entries ?? MAX_FILES, byteLimit = limits?.bytes ?? MAX_INVENTORY_BYTES;
  if (!Number.isSafeInteger(entryLimit) || entryLimit < 1 || entryLimit > MAX_FILES
    || !Number.isSafeInteger(byteLimit) || byteLimit < 1 || byteLimit > MAX_INVENTORY_BYTES) throw new TypeError('Backend inventory overrides may only lower internal admission bounds.');
  const entries = [], observations = new Map(), pending = [{ dir, depth: 0 }];
  let pathBytes = 0;
  while (pending.length) {
    throwIfAborted(signal);
    const current = pending.pop();
    if (current.depth > 32) return null;
    assertNoSymlinkPath(dir, current.dir);
    const before = await fs.lstat(current.dir, { bigint: true });
    if (!before.isDirectory() || before.isSymbolicLink()) throw changed();
    const admitted = await withStorageDirectory(current.dir, async reader => {
      for (;;) {
        const entry = await reader.read();
        if (!entry) break;
        const absolute = path.join(current.dir, entry.name), rel = path.relative(dir, absolute).split(path.sep).join('/');
        pathBytes += Buffer.byteLength(rel) + 128;
        if (entries.length >= entryLimit || pathBytes > byteLimit) return false;
        const stat = await fs.lstat(absolute, { bigint: true });
        if (stat.isSymbolicLink() || !(stat.isDirectory() || stat.isFile())) throw changed();
        if (stat.isFile() && (stat.size < 0n || stat.size > BigInt(Number.MAX_SAFE_INTEGER))) throw changed();
        observations.set(rel, stat);
        entries.push({ path: rel, kind: stat.isDirectory() ? 'dir' : 'file', ...(stat.isFile() ? { bytes: Number(stat.size) } : {}) });
        if (stat.isDirectory()) pending.push({ dir: absolute, depth: current.depth + 1 });
      }
      return true;
    });
    if (!sameStat(before, await fs.lstat(current.dir, { bigint: true }))) throw changed();
    if (!admitted) return null;
  }
  entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  stamps.set(entries, observations);
  return entries;
};

/** Optional closed-writer inventory; large datasets retain the full rebuild
 * path rather than growing unbounded native metadata. */
export const inventoryBackendPayload = async ({ dir, signal = null, limits = null }) => {
  const entries = await listBackendPayloadEntries(dir, signal, limits);
  if (!entries) return null;
  for (const entry of entries) {
    if (entry.kind !== 'file') continue;
    const filename = path.join(dir, entry.path);
    await withContainedFile(dir, filename, async input => {
      const before = await input.stat({ bigint: true }), hash = createHash('sha256');
      if (before.size !== BigInt(entry.bytes)) throw changed();
      const window = Buffer.alloc(Math.min(WINDOW_BYTES, Math.max(1, entry.bytes))); let position = 0;
      while (position < entry.bytes) {
        throwIfAborted(signal);
        const remaining = Math.min(window.length, entry.bytes - position), result = await input.read(window, 0, remaining, position);
        if (!Number.isSafeInteger(result.bytesRead) || result.bytesRead <= 0 || result.bytesRead > remaining) throw changed();
        hash.update(window.subarray(0, result.bytesRead)); position += result.bytesRead;
      }
      input.verify();
      if (!sameStat(before, await input.stat({ bigint: true }))) throw changed();
      entry.checksum = `sha256:${hash.digest('hex')}`;
    });
  }
  const after = await listBackendPayloadEntries(dir, signal, limits);
  if (!after || JSON.stringify(after) !== JSON.stringify(entries.map(({ checksum: unused, ...entry }) => { void unused; return entry; }))) throw changed();
  const initial = stamps.get(entries), final = stamps.get(after);
  for (const [name, stat] of initial) if (!final.has(name) || !sameStat(stat, final.get(name))) throw changed();
  const inventory = { version: 1, entries };
  return Buffer.byteLength(JSON.stringify(inventory)) <= (limits?.bytes ?? MAX_INVENTORY_BYTES) ? inventory : null;
};
