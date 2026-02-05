import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { once } from 'node:events';
import { createTempPath, replaceFile } from './atomic.js';

const writeBuffer = async (stream, buffer) => {
  if (!stream.write(buffer)) {
    await once(stream, 'drain');
  }
};

export const createOffsetsWriter = (filePath, { atomic = false, highWaterMark = null } = {}) => {
  const targetPath = atomic ? createTempPath(filePath) : filePath;
  const stream = fs.createWriteStream(targetPath, highWaterMark ? { highWaterMark } : undefined);
  let bytes = 0;
  let closed = false;

  const writeOffset = async (offset) => {
    const buf = Buffer.allocUnsafe(8);
    buf.writeBigUInt64LE(BigInt(offset));
    bytes += 8;
    await writeBuffer(stream, buf);
  };

  const close = async () => {
    if (closed) return { bytes };
    closed = true;
    stream.end();
    await once(stream, 'finish');
    if (atomic) {
      await replaceFile(targetPath, filePath);
    }
    return { bytes };
  };

  const destroy = async (err) => {
    try {
      stream.destroy(err);
    } catch {}
    try {
      await once(stream, 'close');
    } catch {}
    if (atomic) {
      try { await fsPromises.rm(targetPath, { force: true }); } catch {}
    }
  };

  return { writeOffset, close, destroy, path: filePath };
};
