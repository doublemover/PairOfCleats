import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { assertNoSymlinkPath, openContainedFile, verifyContainedFileHandle } from '../../../src/shared/contained-file.js';
import { createXxhash64Hasher } from '../../../src/shared/hash/xxhash-backend.js';
import { throwIfAborted } from '../../../src/shared/abort.js';

const MAX_FILES = 4096, MAX_INVENTORY_BYTES = 512 * 1024, WINDOW_BYTES = 65536;
const changed = () => Object.assign(new Error('Immutable native backend bytes changed during reuse.'), { code: 'ERR_ANN_REUSE_INTEGRITY' });
const sameStat = (left, right) => ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every(key => left[key] === right[key]);
const digestFor = async checksum => {
  const match = /^(sha256|sha1|xxh64):([a-f0-9]+)$/i.exec(checksum || '');
  if (!match || match[2].length !== ({ sha256: 64, sha1: 40, xxh64: 16 })[match[1].toLowerCase()]) throw changed();
  return { expected: match[2].toLowerCase(), hasher: match[1].toLowerCase() === 'xxh64'
    ? await createXxhash64Hasher() : createHash(match[1].toLowerCase()) };
};

/** Copy descriptor bytes into private staging, verifying the declared digest.
 * No source payload buffer or native handle survives one bounded window. */
export const copyBackendPayloadFile = async ({ sourceRoot, source, target, bytes, checksum, signal = null, metrics = null }) => {
  const { expected, hasher } = await digestFor(checksum);
  throwIfAborted(signal);
  const input = await openContainedFile(sourceRoot, source);
  let output = null, primary = null;
  try {
    const before = await input.stat({ bigint: true });
    if (!Number.isSafeInteger(bytes) || bytes < 0 || before.size !== BigInt(bytes)) throw changed();
    await fs.mkdir(path.dirname(target), { recursive: true });
    output = await fs.open(target, 'wx');
    const window = Buffer.alloc(Math.min(WINDOW_BYTES, Math.max(1, bytes)));
    let position = 0;
    while (position < bytes) {
      throwIfAborted(signal);
      const remaining = Math.min(window.length, bytes - position);
      const { bytesRead } = await input.read(window, 0, remaining, position);
      if (!Number.isSafeInteger(bytesRead) || bytesRead <= 0 || bytesRead > remaining) throw changed();
      hasher.update(window.subarray(0, bytesRead));
      let written = 0;
      while (written < bytesRead) {
        throwIfAborted(signal);
        const progress = (await output.write(window, written, bytesRead - written, position + written)).bytesWritten;
        if (!Number.isSafeInteger(progress) || progress <= 0 || progress > bytesRead - written) throw changed();
        written += progress;
      }
      position += bytesRead;
      if (metrics) metrics.copiedBytes = (metrics.copiedBytes || 0) + bytesRead;
    }
    verifyContainedFileHandle(input, sourceRoot, source);
    if (!sameStat(before, await input.stat({ bigint: true })) || hasher.digest('hex') !== expected) throw changed();
    await output.sync();
  } catch (error) { primary = error; if (output) error.backendCopyTargetCreated = true; throw error; }
  finally {
    const errors = [];
    for (const handle of [output, input]) try { await handle?.close(); } catch (error) { errors.push(error); }
    if (errors.length) throw Object.assign(new AggregateError(primary ? [primary, ...errors] : errors,
      'Native backend copy failed to close its descriptors.', { cause: primary || errors[0] }), { backendCopyTargetCreated: output !== null });
  }
};

const listPayload = async (dir, signal) => {
  const entries = [], pending = [{ dir, depth: 0 }];
  let pathBytes = 0;
  while (pending.length) {
    throwIfAborted(signal);
    const current = pending.pop();
    if (current.depth > 32) return null;
    assertNoSymlinkPath(dir, current.dir);
    const handle = await fs.opendir(current.dir);
    try {
      for await (const entry of handle) {
        const absolute = path.join(current.dir, entry.name), rel = path.relative(dir, absolute).split(path.sep).join('/');
        pathBytes += Buffer.byteLength(rel) + 128;
        if (entries.length >= MAX_FILES || pathBytes > MAX_INVENTORY_BYTES) return null;
        const stat = await fs.lstat(absolute);
        if (stat.isSymbolicLink() || !(stat.isDirectory() || stat.isFile())) throw changed();
        if (stat.isFile() && (!Number.isSafeInteger(stat.size) || stat.size < 0)) throw changed();
        entries.push({ path: rel, kind: stat.isDirectory() ? 'dir' : 'file', ...(stat.isFile() ? { bytes: stat.size } : {}) });
        if (stat.isDirectory()) pending.push({ dir: absolute, depth: current.depth + 1 });
      }
    } finally { try { await handle.close(); } catch (error) { if (error.code !== 'ERR_DIR_CLOSED') throw error; } }
  }
  entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return entries;
};

/** Optional closed-writer inventory; large datasets retain the full rebuild
 * path rather than growing unbounded native metadata. */
export const inventoryBackendPayload = async ({ dir, signal = null }) => {
  const entries = await listPayload(dir, signal);
  if (!entries) return null;
  for (const entry of entries) {
    if (entry.kind !== 'file') continue;
    const filename = path.join(dir, entry.path), input = await openContainedFile(dir, filename);
    try {
      const before = await input.stat({ bigint: true }), hash = createHash('sha256');
      if (before.size !== BigInt(entry.bytes)) throw changed();
      const window = Buffer.alloc(Math.min(WINDOW_BYTES, Math.max(1, entry.bytes))); let position = 0;
      while (position < entry.bytes) {
        throwIfAborted(signal);
        const remaining = Math.min(window.length, entry.bytes - position), result = await input.read(window, 0, remaining, position);
        if (!Number.isSafeInteger(result.bytesRead) || result.bytesRead <= 0 || result.bytesRead > remaining) throw changed();
        hash.update(window.subarray(0, result.bytesRead)); position += result.bytesRead;
      }
      verifyContainedFileHandle(input, dir, filename);
      if (!sameStat(before, await input.stat({ bigint: true }))) throw changed();
      entry.checksum = `sha256:${hash.digest('hex')}`;
    } finally { await input.close(); }
  }
  const after = await listPayload(dir, signal);
  if (!after || JSON.stringify(after) !== JSON.stringify(entries.map(({ checksum: unused, ...entry }) => { void unused; return entry; }))) throw changed();
  const inventory = { version: 1, entries };
  return Buffer.byteLength(JSON.stringify(inventory)) <= MAX_INVENTORY_BYTES ? inventory : null;
};

export const copyBackendPayloadInventory = async ({ sourceRoot, targetRoot, inventory, signal = null, metrics = null }) => {
  if (inventory?.version !== 1 || !Array.isArray(inventory.entries) || inventory.entries.length > MAX_FILES
    || Buffer.byteLength(JSON.stringify(inventory)) > MAX_INVENTORY_BYTES) throw changed();
  const actual = await listPayload(sourceRoot, signal), names = new Set();
  const expected = inventory.entries.map(({ checksum: unused, ...entry }) => { void unused; return entry; });
  if (!actual || JSON.stringify(actual) !== JSON.stringify(expected)) throw changed();
  await fs.mkdir(targetRoot);
  try { for (const entry of inventory.entries) {
    throwIfAborted(signal);
    if (typeof entry.path !== 'string' || names.has(entry.path) || !entry.path || entry.path.includes('\\') || entry.path.includes(':')
      || path.posix.isAbsolute(entry.path) || entry.path.split('/').some(part => !part || part === '.' || part === '..')) throw changed();
    names.add(entry.path);
    const target = path.join(targetRoot, entry.path);
    if (entry.kind === 'dir') await fs.mkdir(target, { recursive: true });
    else if (entry.kind === 'file') await copyBackendPayloadFile({ sourceRoot, source: path.join(sourceRoot, entry.path), target,
      bytes: entry.bytes, checksum: entry.checksum, signal, metrics });
    else throw changed();
  } } catch (error) { error.backendCopyTargetCreated = true; throw error; }
};
