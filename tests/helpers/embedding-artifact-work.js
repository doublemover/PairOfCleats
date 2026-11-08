import fs from 'node:fs';
import promises from 'node:fs/promises';
import path from 'node:path';

/** Observe original opened-file reads, independently of producer counters. */
export const observeEmbeddingArtifactReads = root => {
  const original = { open: promises.open, openSync: fs.openSync, readSync: fs.readSync, closeSync: fs.closeSync };
  const descriptors = new Map(), selected = file => {
    if (typeof file !== 'string') return false;
    const relative = path.relative(root, file);
    return relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
  };
  const metrics = { filesOpened: 0, readCalls: 0, bytesRead: 0, sampledPeakHeapBytes: process.memoryUsage().heapUsed };
  const record = bytes => {
    metrics.readCalls++; metrics.bytesRead += bytes;
    if (metrics.readCalls % 8 === 0) metrics.sampledPeakHeapBytes = Math.max(metrics.sampledPeakHeapBytes, process.memoryUsage().heapUsed);
  };
  promises.open = async function (file, ...args) {
    const handle = await original.open.call(this, file, ...args);
    if (selected(file)) {
      metrics.filesOpened++;
      const read = handle.read.bind(handle);
      handle.read = async (...values) => { const result = await read(...values); record(result.bytesRead); return result; };
    }
    return handle;
  };
  fs.openSync = function (file, ...args) {
    const fd = original.openSync.call(this, file, ...args);
    if (selected(file)) { descriptors.set(fd, file); metrics.filesOpened++; }
    return fd;
  };
  fs.readSync = function (fd, ...args) {
    const count = original.readSync.call(this, fd, ...args);
    if (descriptors.has(fd)) record(count);
    return count;
  };
  fs.closeSync = function (fd, ...args) {
    const value = original.closeSync.call(this, fd, ...args); descriptors.delete(fd); return value;
  };
  return { metrics, stop() {
    promises.open = original.open; fs.openSync = original.openSync;
    fs.readSync = original.readSync; fs.closeSync = original.closeSync;
  } };
};
