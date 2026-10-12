import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { atomicWriteText } from '../../shared/io/atomic-write.js';
import { withFileLock } from '../../shared/locks/file-lock.js';
import { assertNoSymlinkPath, openContainedFile } from '../../shared/contained-file.js';

export const FILTER_MATCH_ENTRY_BYTES = 16 * 1024 * 1024;
export const FILTER_MATCH_CACHE_BYTES = 64 * 1024 * 1024;
const HEADER_BYTES = 128 * 1024;
const BLOCK_BYTES = 16 * 1024;
const ENTRY_LIMIT = 32;
const sha = value => createHash('sha256').update(value).digest('hex');
const sign = (value, key) => createHmac('sha256', key).update(value).digest();
const directory = cacheDir => cacheDir ? path.join(cacheDir, 'filter-enumeration-v1') : null;
const filename = identity => sha(identity) + '.bin';

const readExact = async (handle, buffer, position) => {
  let read = 0;
  while (read < buffer.length) {
    const result = await handle.read(buffer, read, buffer.length - read, position + read);
    if (!result.bytesRead) throw new Error('Incomplete filter continuation cache.');
    read += result.bytesRead;
  }
  return buffer;
};
const openRegular = async (root, file) => {
  const handle = await openContainedFile(root, file);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1) throw new Error('Invalid filter continuation file.');
    return { handle, stat };
  } catch (error) { await handle.close(); throw error; }
};
const readKey = async (root, dir) => {
  const { handle, stat } = await openRegular(root, path.join(dir, 'key'));
  try {
    if (stat.size !== 32) throw new Error('Invalid filter continuation key.');
    return await readExact(handle, Buffer.alloc(32), 0);
  } finally { await handle.close(); }
};

/** Optional acceleration only: authenticate bounded metadata, then verify only
 * the opened blocks needed by this page. Failure always returns to the index. */
export const readFilterMatchPage = async ({ cacheDir, identity, rowCount, offset, limit, throwIfAborted }) => {
  const dir = directory(cacheDir);
  if (!dir) return null;
  let handle;
  try {
    throwIfAborted?.();
    const key = await readKey(cacheDir, dir);
    const opened = await openRegular(cacheDir, path.join(dir, filename(identity)));
    handle = opened.handle;
    if (opened.stat.size > FILTER_MATCH_ENTRY_BYTES + HEADER_BYTES + 4) return null;
    const size = (await readExact(handle, Buffer.alloc(4), 0)).readUInt32LE();
    if (size < 1 || size > HEADER_BYTES) return null;
    const headerBytes = await readExact(handle, Buffer.alloc(size), 4);
    const envelope = JSON.parse(headerBytes.toString('utf8'));
    if (typeof envelope.data !== 'string' || !/^[a-f0-9]{64}$/.test(envelope.mac)) return null;
    if (!timingSafeEqual(sign(envelope.data, key), Buffer.from(envelope.mac, 'hex'))) return null;
    const header = JSON.parse(envelope.data);
    if (header.version !== 1 || header.identity !== identity || header.rowCount !== rowCount
      || !Number.isSafeInteger(header.total) || header.total < 0 || header.total > rowCount
      || header.total * 4 > FILTER_MATCH_ENTRY_BYTES || header.blockBytes !== BLOCK_BYTES
      || !Array.isArray(header.hashes) || header.hashes.length !== Math.ceil(header.total * 4 / BLOCK_BYTES)
      || header.hashes.some(value => !/^[a-f0-9]{64}$/.test(value))
      || opened.stat.size !== 4 + size + header.total * 4) return null;
    const end = Math.min(header.total, offset + limit);
    const ids = new Uint32Array(Math.max(0, end - offset));
    let bytes = 32 + 4 + size;
    for (let block = Math.floor(offset * 4 / BLOCK_BYTES); block < Math.ceil(end * 4 / BLOCK_BYTES); block += 1) {
      throwIfAborted?.();
      const start = block * BLOCK_BYTES;
      const buffer = await readExact(handle, Buffer.alloc(Math.min(BLOCK_BYTES, header.total * 4 - start)), 4 + size + start);
      bytes += buffer.length;
      if (sha(buffer) !== header.hashes[block]) return null;
      for (let i = Math.max(offset, start / 4); i < Math.min(end, (start + buffer.length) / 4); i += 1) {
        const id = buffer.readUInt32LE(i * 4 - start);
        if (id >= rowCount || i > offset && id <= ids[i - offset - 1]) return null;
        ids[i - offset] = id;
      }
    }
    throwIfAborted?.();
    return { ids, total: header.total, readBytes: bytes };
  } catch { throwIfAborted?.(); return null; }
  finally { await handle?.close(); }
};

/** Serialize admission/eviction with the shared lock owner. Oversized results
 * never persist and callers continue streaming with a bounded page buffer. */
export const persistFilterMatches = async ({ cacheDir, identity, rowCount, ids, throwIfAborted }) => {
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
      try { key = await readKey(cacheDir, dir); }
      catch (error) {
        if (error.code !== 'ENOENT') return false;
        key = randomBytes(32);
        assertNoSymlinkPath(cacheDir, path.join(dir, 'key'), { allowMissing: true });
        await fs.writeFile(path.join(dir, 'key'), key, { flag: 'wx', mode: 0o600 });
      }
      const body = Buffer.alloc(ids.byteLength), hashes = [];
      for (let block = 0; block < body.length; block += BLOCK_BYTES) {
        if (block % (64 * BLOCK_BYTES) === 0) {
          throwIfAborted?.(); await new Promise(resolve => setImmediate(resolve)); throwIfAborted?.();
        }
        const end = Math.min(body.length, block + BLOCK_BYTES);
        for (let at = block; at < end; at += 4) body.writeUInt32LE(ids[at / 4], at);
        hashes.push(sha(body.subarray(block, end)));
      }
      const data = JSON.stringify({ version: 1, identity, rowCount, total: ids.length, blockBytes: BLOCK_BYTES, hashes });
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
  } catch { throwIfAborted?.(); return false; }
};
