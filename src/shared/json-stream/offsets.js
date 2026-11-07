import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { createTempPath, replaceFile } from './atomic.js';
import { waitForStreamEvent } from './streams.js';
import { finished } from 'node:stream/promises';
import { addStorageFailureContext } from '../storage/operation-error.js';

const writeBuffer = async (stream, buffer) => {
  if (!stream.write(buffer)) {
    await waitForStreamEvent(stream, 'drain', { label: 'json-stream.offsets.drain' });
  }
};

export const createOffsetsWriter = (filePath, { atomic = false, highWaterMark = null } = {}) => {
  const targetPath = atomic ? createTempPath(filePath) : filePath;
  const stream = fs.createWriteStream(targetPath, highWaterMark ? { highWaterMark } : undefined);
  const done = finished(stream, { cleanup: true });
  const closedEvent = stream.closed ? Promise.resolve() : new Promise(resolve => stream.once('close', resolve));
  done.catch(() => {});
  let failure = null;
  const independentErrors = [];
  stream.on('error', error => { failure ||= error; independentErrors.push(error); });
  let bytes = 0;
  let closed = false;
  let closePromise = null;

  const writeOffset = async (offset) => {
    if (failure) throw failure;
    if (closed) throw new Error('JSONL offsets writer closed.');
    if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError('JSONL offset must be a nonnegative safe integer.');
    const buf = Buffer.allocUnsafe(8);
    buf.writeBigUInt64LE(BigInt(offset));
    bytes += 8;
    await writeBuffer(stream, buf);
    if (failure) throw failure;
  };

  const close = () => {
    if (closePromise) return closePromise;
    closed = true;
    closePromise = (async () => {
      stream.end(); await done; await closedEvent;
      if (atomic) await replaceFile(targetPath, filePath);
      return { bytes };
    })();
    return closePromise;
  };

  const destroy = async (err) => {
    closed = true;
    let primary = err, failed = false;
    try { stream.destroy(err); } catch (error) { primary = error; failed = true; }
    try { await done; } catch (error) {
      if (error !== err && !(!err && error.code === 'ERR_STREAM_PREMATURE_CLOSE')) { primary = error; failed = true; }
    }
    await closedEvent;
    for (const error of new Set(independentErrors)) if (error !== err && error !== primary) {
      primary = failed ? addStorageFailureContext(primary, {}, error, { secondaryPresent: true }) : error;
      failed = true;
    }
    if (atomic) {
      try { await fsPromises.rm(targetPath, { force: true }); } catch (error) {
        primary = failed ? addStorageFailureContext(primary, {}, error, { secondaryPresent: true }) : error;
        failed = true;
      }
    }
    if (failed) throw primary;
  };

  return { writeOffset, close, destroy, path: filePath };
};
