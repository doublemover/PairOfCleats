import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { constants as bufferConstants } from 'node:buffer';
import { createContainedFileResource } from './contained-file-resource.js';

const changed = () => Object.assign(new Error('JSON read file changed during its descriptor borrow.'), { code: 'ERR_FILE_CHANGED' });
const admit = (stat, admitStat) => {
  if (!stat.isFile() || !Number.isSafeInteger(stat.size) || stat.size < 0 || stat.size > bufferConstants.MAX_LENGTH) {
    throw new Error('JSON read requires a bounded regular file.');
  }
  admitStat?.(stat);
  return Buffer.allocUnsafe(stat.size);
};
const unchanged = (before, after) => {
  if (!after.isFile() || ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].some(key => before[key] !== after[key])) throw changed();
};
const progress = (count, allowance) => {
  if (!Number.isSafeInteger(count) || count <= 0 || count > allowance) throw changed();
  return count;
};

/** Internal JSON consumer borrow; no path mutation, implicit native retry or
 * category authority. Text conversion follows confirmed descriptor closure.
 */
export const readJsonResourceText = async (filePath, admitStat = null) => {
  const open = fsp.open, handle = await open.call(fsp, filePath, 'r');
  const owner = createContainedFileResource({ handle, sync: false });
  const bytes = await owner.run(async descriptor => {
    const before = await descriptor.stat(), buffer = admit(before, admitStat);
    let position = 0;
    while (position < buffer.length) {
      const count = Math.min(65536, buffer.length - position);
      const { bytesRead } = await descriptor.read(buffer, position, count, position);
      position += progress(bytesRead, count);
    }
    unchanged(before, await descriptor.stat());
    return buffer;
  });
  return bytes.toString('utf8');
};

export const readJsonResourceTextSync = (filePath, admitStat = null) => {
  const methods = { receiver: fs, close: fs.closeSync, stat: fs.fstatSync, read: fs.readSync };
  const fd = fs.openSync(filePath, 'r'), owner = createContainedFileResource({ fd, sync: true, methods });
  const bytes = owner.runSync(descriptor => {
    const before = descriptor.stat(), buffer = admit(before, admitStat);
    let position = 0;
    while (position < buffer.length) {
      const count = Math.min(65536, buffer.length - position);
      position += progress(descriptor.read(buffer, position, count, position), count);
    }
    unchanged(before, descriptor.stat());
    return buffer;
  });
  return bytes.toString('utf8');
};
