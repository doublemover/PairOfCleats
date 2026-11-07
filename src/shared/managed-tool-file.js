import fs from 'node:fs';
import crypto from 'node:crypto';
import { createContainedFileResource } from './contained-file-resource.js';

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
  const methods = { receiver: fs, close: fs.closeSync, stat: fs.fstatSync, read: fs.readSync };
  const fd = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  return createContainedFileResource({ fd, sync: true, methods }).runSync(descriptor => {
    const opened = descriptor.stat({ bigint: true });
    if (!opened.isFile() || fileIdentity(opened) !== identity) {
      throw new Error('Managed tool file changed before reading.');
    }
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let offset = 0;
    while (offset < size) {
      const wanted = Math.min(buffer.length, size - offset);
      const read = descriptor.read(buffer, 0, wanted, offset);
      if (!Number.isSafeInteger(read) || read <= 0 || read > wanted) throw new Error('Managed tool file read made invalid progress.');
      hash.update(buffer.subarray(0, read));
      offset += read;
    }
    const after = descriptor.stat({ bigint: true });
    if (fileIdentity(after) !== identity) throw new Error('Managed tool file changed while reading.');
    const digest = hash.digest('hex');
    return digest;
  });
};

export const readManagedToolText = (filePath, maxBytes = 16 * 1024) => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) return null;
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.size <= 0 || stat.size > maxBytes) return null;
  const methods = { receiver: fs, close: fs.closeSync, stat: fs.fstatSync, read: fs.readSync };
  const fd = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  return createContainedFileResource({ fd, sync: true, methods }).runSync(descriptor => {
    const opened = descriptor.stat();
    if (opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size) return null;
    const buffer = Buffer.allocUnsafe(stat.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const wanted = buffer.length - offset;
      const read = descriptor.read(buffer, offset, wanted, offset);
      if (!Number.isSafeInteger(read) || read < 0 || read > wanted) throw new Error('Managed tool text read made invalid progress.');
      if (!read) break;
      offset += read;
    }
    const after = descriptor.stat();
    if (offset !== stat.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) return null;
    return buffer.subarray(0, offset).toString('utf8');
  });
};
