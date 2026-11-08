import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { atomicWriteText } from '../../shared/io/atomic-write.js';
import { withFileLock } from '../../shared/locks/file-lock.js';
import { assertNoSymlinkPath, withContainedFile } from '../../shared/contained-file.js';
import { observeStorageResource } from '../../shared/storage/failure-observation.js';
import { readExactAt } from '../../shared/io/read-exact.js';
import { addStorageFailureContext } from '../../shared/storage/operation-error.js';

export const FILTER_MATCH_ENTRY_BYTES = 16 * 1024 * 1024;
export const FILTER_MATCH_CACHE_BYTES = 64 * 1024 * 1024;
const HEADER_BYTES = 128 * 1024;
const BLOCK_BYTES = 16 * 1024;
const ENTRY_LIMIT = 32;
const sha = value => createHash('sha256').update(value).digest('hex');
const sign = (value, key) => createHmac('sha256', key).update(value).digest();
const directory = cacheDir => cacheDir ? path.join(cacheDir, 'filter-enumeration-v1') : null;
const filename = identity => sha(identity) + '.bin';

const readExact = async (handle, buffer, position, checkpoint = null) => {
  const reader = checkpoint ? { read: async (...args) => {
    checkpoint(); const result = await handle.read(...args); checkpoint(); return result;
  } } : handle;
  const { bytesRead } = await readExactAt(reader, buffer, 0, buffer.length, position);
  if (bytesRead !== buffer.length) throw new Error('Incomplete filter continuation cache.');
  return buffer;
};
const withRegular = (root, file, action) => withContainedFile(root, file, async descriptor => {
  const before = await descriptor.stat();
  if (!before.isFile() || before.nlink !== 1) throw new Error('Invalid filter continuation file.');
  const value = await action(descriptor, before);
  const after = await descriptor.stat();
  if (!after.isFile() || ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs', 'nlink'].some(key => before[key] !== after[key])) {
    throw new Error('Filter continuation file changed during its original read.');
  }
  descriptor.verify();
  return value;
});
const readKey = (root, dir, checkpoint = null) => withRegular(root, path.join(dir, 'key'), async (descriptor, stat) => {
  if (stat.size !== 32) throw new Error('Invalid filter continuation key.');
  return readExact(descriptor, Buffer.alloc(32), 0, checkpoint);
});

const requireSettledCacheFailure = (error, phase, checkpoint) => {
  const observation = observeStorageResource(error, { phase });
  let retained, pending = false;
  try { observation.requireSettled(); }
  catch (failure) { retained = failure; pending = true; }
  try { checkpoint?.(); }
  catch (cancellation) {
    throw addStorageFailureContext(pending ? retained : observation.primary, {}, cancellation, { secondaryPresent: true });
  }
  if (pending) throw retained;
};

/** Optional acceleration only: authenticate bounded metadata, then verify only
 * the opened blocks needed by this page. Settled corrupt/missing data is a miss;
 * unresolved original resources propagate before another owner can proceed. */
export const readFilterMatchPage = async ({ cacheDir, identity, rowCount = null, offset, limit, includeRows = false, throwIfAborted }) => {
  const dir = directory(cacheDir);
  if (!dir || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1) return null;
  try {
    throwIfAborted?.();
    const key = await readKey(cacheDir, dir, throwIfAborted);
    const result = await withRegular(cacheDir, path.join(dir, filename(identity)), async (handle, stat) => {
      if (stat.size > FILTER_MATCH_ENTRY_BYTES + HEADER_BYTES + 4) return null;
      const size = (await readExact(handle, Buffer.alloc(4), 0, throwIfAborted)).readUInt32LE();
      if (size < 1 || size > HEADER_BYTES) return null;
      const headerBytes = await readExact(handle, Buffer.alloc(size), 4, throwIfAborted);
      const envelope = JSON.parse(headerBytes.toString('utf8'));
      if (typeof envelope.data !== 'string' || !/^[a-f0-9]{64}$/.test(envelope.mac)) return null;
      if (!timingSafeEqual(sign(envelope.data, key), Buffer.from(envelope.mac, 'hex'))) return null;
      const header = JSON.parse(envelope.data);
      const bodyBytes = header.version === 1 ? header.total * 4 : header.bodyBytes;
      const hasRows = header.version === 2;
      if (![1, 2].includes(header.version) || header.identity !== identity
      || !Number.isSafeInteger(header.rowCount) || header.rowCount < 0 || header.rowCount > 0xffffffff
      || rowCount != null && header.rowCount !== rowCount
      || !Number.isSafeInteger(header.total) || header.total < 0 || header.total > header.rowCount
      || !Number.isSafeInteger(bodyBytes) || bodyBytes < header.total * 4 || bodyBytes > FILTER_MATCH_ENTRY_BYTES
      || hasRows && bodyBytes < header.total * 8 + 4 || header.blockBytes !== BLOCK_BYTES
      || !Array.isArray(header.hashes) || header.hashes.length !== Math.ceil(bodyBytes / BLOCK_BYTES)
      || header.hashes.some(value => !/^[a-f0-9]{64}$/.test(value))
      || stat.size !== 4 + size + bodyBytes) return null;
      const end = Math.min(header.total, offset + limit);
      const count = Math.max(0, end - offset), ids = new Uint32Array(count);
      let bytes = 32 + 4 + size;
      const blocks = new Map();
      const readRange = async (start, length) => {
        if (start < 0 || length < 0 || start + length > bodyBytes) throw new Error('Invalid continuation range.');
        const result = Buffer.alloc(length);
        for (let block = Math.floor(start / BLOCK_BYTES); length && block < Math.ceil((start + length) / BLOCK_BYTES); block++) {
          throwIfAborted?.();
          let buffer = blocks.get(block);
          const blockStart = block * BLOCK_BYTES;
          if (!buffer) {
            buffer = await readExact(handle, Buffer.alloc(Math.min(BLOCK_BYTES, bodyBytes - blockStart)), 4 + size + blockStart, throwIfAborted);
            bytes += buffer.length;
            if (sha(buffer) !== header.hashes[block]) throw new Error('Corrupt continuation block.');
            blocks.set(block, buffer);
          }
          const from = Math.max(start, blockStart), to = Math.min(start + length, blockStart + buffer.length);
          buffer.copy(result, from - start, from - blockStart, to - blockStart);
        }
        return result;
      };
      const idBytes = count ? await readRange(offset * 4, count * 4) : Buffer.alloc(0);
      for (let i = 0; i < count; i++) {
        const id = idBytes.readUInt32LE(i * 4);
        if (id >= header.rowCount || i && id <= ids[i - 1]) return null;
        ids[i] = id;
      }
      let rows = null;
      if (hasRows && includeRows) {
        rows = [];
        if (count) {
          const positions = await readRange(header.total * 4 + offset * 4, (count + 1) * 4);
          const rowBase = header.total * 8 + 4;
          for (let i = 0; i < count; i++) {
            if (i % 256 === 0) { await new Promise(resolve => setImmediate(resolve)); throwIfAborted?.(); }
            const from = positions.readUInt32LE(i * 4), to = positions.readUInt32LE((i + 1) * 4);
            if (to <= from || rowBase + to > bodyBytes) return null;
            const row = JSON.parse((await readRange(rowBase + from, to - from)).toString('utf8'));
            if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
            rows.push(row);
          }
        }
      }
      throwIfAborted?.();
      return { ids, rows, rowCount: header.rowCount, total: header.total, readBytes: bytes };
    });
    throwIfAborted?.();
    return result;
  } catch (error) {
    requireSettledCacheFailure(error, 'filter-continuation-read', throwIfAborted);
    return null;
  }
};

// Rows share the existing entry, physical-byte cap, authentication and eviction
// owner. If row payloads do not fit, retain the original ID-only acceleration.
const encodeBody = async (ids, metadata, throwIfAborted) => {
  const idBytes = Buffer.alloc(ids.byteLength);
  for (let i = 0; i < ids.length; i++) idBytes.writeUInt32LE(ids[i], i * 4);
  if (!metadata || ids.byteLength * 2 + 4 > FILTER_MATCH_ENTRY_BYTES) return { body: idBytes, version: 1 };
  const offsets = Buffer.alloc((ids.length + 1) * 4), rows = [];
  let bytes = 0;
  try {
    for (let i = 0; i < ids.length; i++) {
      if (i % 256 === 0) { await new Promise(resolve => setImmediate(resolve)); throwIfAborted?.(); }
      const row = metadata[ids[i]];
      if (!row || typeof row !== 'object' || Array.isArray(row)) return { body: idBytes, version: 1 };
      const encoded = Buffer.from(JSON.stringify(row));
      bytes += encoded.length;
      if (idBytes.length + offsets.length + bytes > FILTER_MATCH_ENTRY_BYTES) return { body: idBytes, version: 1 };
      offsets.writeUInt32LE(bytes, (i + 1) * 4); rows.push(encoded);
    }
  } catch (error) {
    requireSettledCacheFailure(error, 'filter-continuation-row-encoding', throwIfAborted);
    return { body: idBytes, version: 1 };
  }
  return { body: Buffer.concat([idBytes, offsets, ...rows]), version: 2 };
};

/** Serialize admission/eviction with the shared lock owner. Oversized results
 * never persist and callers continue streaming with a bounded page buffer. */
export const persistFilterMatches = async ({ cacheDir, identity, rowCount, ids, metadata = null, throwIfAborted }) => {
  const dir = directory(cacheDir);
  if (!dir || ids.byteLength > FILTER_MATCH_ENTRY_BYTES) return false;
  try {
    await fs.mkdir(cacheDir, { recursive: true });
    assertNoSymlinkPath(cacheDir, dir, { allowMissing: true });
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    assertNoSymlinkPath(cacheDir, path.join(dir, 'admission.lock'), { allowMissing: true });
    const result = await withFileLock({ lockPath: path.join(dir, 'admission.lock'), waitMs: 0 }, async () => {
      assertNoSymlinkPath(cacheDir, dir);
      throwIfAborted?.();
      let key;
      try { key = await readKey(cacheDir, dir, throwIfAborted); }
      catch (error) {
        requireSettledCacheFailure(error, 'filter-continuation-key', throwIfAborted);
        if (error?.code !== 'ENOENT') return false;
        key = randomBytes(32);
        assertNoSymlinkPath(cacheDir, path.join(dir, 'key'), { allowMissing: true });
        await fs.writeFile(path.join(dir, 'key'), key, { flag: 'wx', mode: 0o600 });
      }
      const { body, version } = await encodeBody(ids, metadata, throwIfAborted);
      const hashes = [];
      for (let block = 0; block < body.length; block += BLOCK_BYTES) {
        if (block % (64 * BLOCK_BYTES) === 0) {
          throwIfAborted?.(); await new Promise(resolve => setImmediate(resolve)); throwIfAborted?.();
        }
        hashes.push(sha(body.subarray(block, Math.min(body.length, block + BLOCK_BYTES))));
      }
      const data = JSON.stringify({ version, identity, rowCount, total: ids.length, bodyBytes: body.length, blockBytes: BLOCK_BYTES, hashes });
      const header = Buffer.from(JSON.stringify({ data, mac: sign(data, key).toString('hex') }));
      if (header.length > HEADER_BYTES) return false;
      const size = Buffer.alloc(4); size.writeUInt32LE(header.length);
      const payload = Buffer.concat([size, header, body]);
      const entries = [];
      let seen = 0;
      const stream = await fs.opendir(dir);
      for await (const entry of stream) {
        if (++seen > 128) return false;
        if (!entry.isFile() || !/^[a-f0-9]{64}\.bin$/.test(entry.name)) continue;
        assertNoSymlinkPath(cacheDir, path.join(dir, entry.name));
        const stat = await fs.lstat(path.join(dir, entry.name));
        entries.push({ name: entry.name, size: stat.size, time: stat.mtimeMs });
      }
      const target = filename(identity);
      // The old target stays charged until replacement. Reserve the full
      // temporary sibling too, so physical representation bytes stay bounded.
      let bytes = entries.reduce((sum, entry) => sum + entry.size, 0);
      let count = entries.length;
      for (const entry of entries.sort((a, b) => a.time - b.time)) {
        if (bytes + payload.length <= FILTER_MATCH_CACHE_BYTES && count < ENTRY_LIMIT) break;
        if (entry.name === target) continue;
        assertNoSymlinkPath(cacheDir, path.join(dir, entry.name));
        await fs.rm(path.join(dir, entry.name), { force: true }); bytes -= entry.size; count -= 1;
      }
      throwIfAborted?.();
      if (bytes + payload.length > FILTER_MATCH_CACHE_BYTES || count >= ENTRY_LIMIT) return false;
      assertNoSymlinkPath(cacheDir, path.join(dir, target), { allowMissing: true });
      await atomicWriteText(path.join(dir, target), payload, { mode: 0o600 });
      throwIfAborted?.();
      return true;
    });
    return result === true;
  } catch (error) {
    requireSettledCacheFailure(error, 'filter-continuation-persist', throwIfAborted);
    return false;
  }
};
