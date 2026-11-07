import fs from 'node:fs';
import promises from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';

/** Independent original-descriptor counters; no producer metrics or raw buffers. */
export const observeValidationReads = root => {
  const originals = { open: promises.open, openSync: fs.openSync, readSync: fs.readSync, closeSync: fs.closeSync, read: fs.read, close: fs.close };
  const descriptors = new Map();
  const metrics = { files: {}, bytesRead: 0, opens: 0, readCalls: 0, sampledPeakHeapBytes: process.memoryUsage().heapUsed };
  const selected = file => {
    if (typeof file !== 'string') return null;
    const relative = path.relative(root, file);
    return relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)
      ? relative.replaceAll(path.sep, '/') : null;
  };
  const opened = file => {
    const relative = selected(file); if (!relative) return null;
    const row = metrics.files[relative] ||= { opens: 0, readCalls: 0, bytesRead: 0 };
    row.opens++; metrics.opens++; return row;
  };
  const record = (row, bytes) => {
    row.readCalls++; row.bytesRead += bytes; metrics.readCalls++; metrics.bytesRead += bytes;
    metrics.sampledPeakHeapBytes = Math.max(metrics.sampledPeakHeapBytes, process.memoryUsage().heapUsed);
  };
  promises.open = async function (file, ...args) {
    const handle = await originals.open.call(this, file, ...args), row = opened(file);
    if (row) {
      descriptors.set(handle.fd, row);
      const close = handle.close.bind(handle), fd = handle.fd;
      handle.close = async (...input) => { const value = await close(...input); descriptors.delete(fd); return value; };
      const read = handle.read.bind(handle);
      handle.read = async (...input) => { const value = await read(...input); record(row, value.bytesRead); return value; };
    }
    if (!row) descriptors.delete(handle.fd);
    return handle;
  };
  fs.openSync = function (file, ...args) {
    const fd = originals.openSync.call(this, file, ...args), row = opened(file);
    if (row) descriptors.set(fd, row); else descriptors.delete(fd); return fd;
  };
  fs.close = function (fd, callback) {
    return originals.close.call(this, fd, error => { if (!error) descriptors.delete(fd); callback(error); });
  };
  fs.read = function (fd, ...args) {
    const row = descriptors.get(fd);
    if (row) {
      const callback = args.pop();
      args.push((error, bytes, buffer) => { if (!error) record(row, bytes); callback(error, bytes, buffer); });
    }
    return originals.read.call(this, fd, ...args);
  };
  fs.readSync = function (fd, ...args) {
    const bytes = originals.readSync.call(this, fd, ...args), row = descriptors.get(fd);
    if (row) record(row, bytes); return bytes;
  };
  fs.closeSync = function (fd, ...args) {
    const result = originals.closeSync.call(this, fd, ...args); descriptors.delete(fd); return result;
  };
  return { metrics, stop() {
    promises.open = originals.open; fs.openSync = originals.openSync;
    fs.close = originals.close; fs.read = originals.read; fs.readSync = originals.readSync; fs.closeSync = originals.closeSync;
  } };
};

/** Both arms use the current complete validator and exact contracts. The control
 * disables only invocation-local fusion, retaining the original eager checksum gate. */
export const loadValidationArm = async arm => {
  if (!['fused', 'eager'].includes(arm)) throw new TypeError('Explicit validation arm required.');
  const validator = new URL('../../src/index/validate.js', import.meta.url);
  validator.searchParams.set('validation-audit-arm', arm);
  const plan = new URL('../../src/index/validate/read-plan.js', import.meta.url).href;
  const replacement = 'fixture:validation-eager-read-plan';
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      const result = next(specifier, context);
      if (arm === 'eager' && context.parentURL === validator.href && result.url === plan) return { url: replacement, shortCircuit: true };
      return result;
    },
    load(url, context, next) {
      if (url === replacement) return { format: 'module', shortCircuit: true, source: 'export const createValidationReadPlan = () => null;' };
      return next(url, context);
    }
  });
  try { return (await import(validator.href)).validateIndexArtifacts; }
  finally { hooks.deregister(); }
};
