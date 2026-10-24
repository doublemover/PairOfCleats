import fs from 'node:fs';
import crypto from 'node:crypto';

const fileIdentity = (stat) => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');

/** Hash current bytes: filesystem timestamps can collide after a same-size edit.
 * Keep the bounded buffer and opened-file identity checks; metadata cannot prove
 * that a previously observed digest still describes this mutable file.
 */
export const hashManagedToolFile = (filePath, maxBytes = 64 * 1024 * 1024) => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('Invalid managed tool byte limit.');
  const before = fs.lstatSync(filePath, { bigint: true });
  const size = Number(before.size);
  if (!before.isFile() || size <= 0 || size > maxBytes) throw new Error('Invalid managed tool file.');
  const identity = fileIdentity(before);
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
