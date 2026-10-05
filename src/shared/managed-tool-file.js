import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

const verifiedHashes = new Map();
const MAX_HASH_ENTRIES = 16;
const MAX_HASH_PROXY_BYTES = 128 * 1024;
let retainedHashProxyBytes = 0;
const fileIdentity = (stat) => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');

const rememberHash = (key, identity, digest) => {
  // Conservative UTF-16 string storage plus a declared reference/object proxy.
  // This bounds retained evidence; it is not an RSS or exact JS-heap measure.
  const bytes = 2 * (key.length + identity.length + digest.length) + 256;
  const old = verifiedHashes.get(key);
  if (old) {
    retainedHashProxyBytes -= old.bytes;
    verifiedHashes.delete(key);
  }
  if (bytes > MAX_HASH_PROXY_BYTES) return;
  while (verifiedHashes.size >= MAX_HASH_ENTRIES || retainedHashProxyBytes + bytes > MAX_HASH_PROXY_BYTES) {
    const oldest = verifiedHashes.keys().next().value;
    retainedHashProxyBytes -= verifiedHashes.get(oldest).bytes;
    verifiedHashes.delete(oldest);
  }
  verifiedHashes.set(key, { identity, digest, bytes });
  retainedHashProxyBytes += bytes;
};

/** Hash only regular stable files, with a bounded buffer and no executable launch. */
export const hashManagedToolFile = (filePath, maxBytes = 64 * 1024 * 1024) => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('Invalid managed tool byte limit.');
  const before = fs.lstatSync(filePath, { bigint: true });
  const size = Number(before.size);
  if (!before.isFile() || size <= 0 || size > maxBytes) throw new Error('Invalid managed tool file.');
  const key = path.resolve(filePath);
  const identity = fileIdentity(before);
  const cached = verifiedHashes.get(key);
  if (cached?.identity === identity) return cached.digest;
  const fd = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    if (!opened.isFile() || fileIdentity(opened) !== identity) {
      throw new Error('Managed tool file changed before reading.');
    }
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let offset = 0;
    while (offset < size) {
      const read = fs.readSync(fd, buffer, 0, Math.min(buffer.length, size - offset), offset);
      if (!read) throw new Error('Managed tool file was truncated.');
      hash.update(buffer.subarray(0, read));
      offset += read;
    }
    const after = fs.fstatSync(fd, { bigint: true });
    if (fileIdentity(after) !== identity) throw new Error('Managed tool file changed while reading.');
    const digest = hash.digest('hex');
    rememberHash(key, identity, digest);
    return digest;
  } finally {
    fs.closeSync(fd);
  }
};

export const readManagedToolText = (filePath, maxBytes = 16 * 1024) => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) return null;
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.size <= 0 || stat.size > maxBytes) return null;
  const fd = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = fs.fstatSync(fd);
    if (opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size) return null;
    const buffer = Buffer.allocUnsafe(stat.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const read = fs.readSync(fd, buffer, offset, buffer.length - offset, offset);
      if (!read) break;
      offset += read;
    }
    const after = fs.fstatSync(fd);
    if (offset !== stat.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) return null;
    return buffer.subarray(0, offset).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
};
