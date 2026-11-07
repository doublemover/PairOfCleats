import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createContainedFileResource, getContainedFileSession } from '../../shared/contained-file-resource.js';

const MAX_FILES = 128, MAX_BYTES = 64 * 1024 * 1024, MAX_CACHE_ENTRIES = 4096;

// Capture the original methods before acquisition. A failed numeric close is
// retained by the existing descriptor owner and must never become advisory null.
const withInstalledFile = (file, action) => {
  const open = fs.openSync;
  const methods = { receiver: fs, close: fs.closeSync, stat: fs.fstatSync, read: fs.readSync };
  const fd = open.call(fs, file, 'r');
  return createContainedFileResource({ fd, sync: true, methods }).runSync(action);
};
const unchanged = (before, after) => before.size === after.size
  && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs;
const readMetadata = file => withInstalledFile(file, descriptor => {
  const before = descriptor.stat();
  if (!before.isFile() || !Number.isSafeInteger(before.size) || before.size < 0 || before.size > 65536) return null;
  const buffer = Buffer.allocUnsafe(before.size);
  let offset = 0;
  while (offset < buffer.length) {
    const read = descriptor.read(buffer, offset, buffer.length - offset, offset);
    if (!Number.isSafeInteger(read) || read <= 0 || read > buffer.length - offset) return null;
    offset += read;
  }
  return unchanged(before, descriptor.stat()) ? buffer.toString('utf8') : null;
});

/** Fingerprint the actually loaded installed CommonJS/native module closure.
 * An unavailable identity disables advisory reuse. Unsettled owned resources
 * propagate to the caller instead of allowing parser fallback to hide them.
 * No module is imported or executed by this helper. */
export const fingerprintLoadedNativeArtifact = ({ require, value, moduleName, exportKey = null }) => {
  try {
    const entries = Object.values(require.cache);
    if (entries.length > MAX_CACHE_ENTRIES) return null;
    const roots = entries.filter(entry => entry.exports === value || exportKey
      && entry.exports && Object.getOwnPropertyDescriptor(entry.exports,exportKey)?.value === value);
    const bindings = new Set(roots.filter(entry => entry.filename?.endsWith('.node')).map(entry => entry.filename));
    if (!bindings.size) return null;
    const files = new Set(), pending = [...roots], visited = new Set();
    while (pending.length) {
      const entry = pending.pop();
      if (!entry || visited.has(entry)) continue;
      // node-gyp-build is shared across grammar loads. Its dynamically loaded
      // foreign binaries do not belong to this selected binding's identity.
      if (entry.filename?.endsWith('.node') && !bindings.has(entry.filename)) continue;
      visited.add(entry);
      if (visited.size > MAX_FILES || typeof entry.filename !== 'string') return null;
      files.add(entry.filename);
      pending.push(...entry.children);
    }
    // Metadata affects the selected grammar and native node-type wrapper too.
    let directory = path.dirname(require.resolve(moduleName)), packageRoot = null;
    for (let depth = 0; depth < 8; depth++) {
      const candidate = path.join(directory, 'package.json');
      if (fs.existsSync(candidate)) {
        const contents = readMetadata(candidate);
        if (contents === null) return null;
        const metadata = JSON.parse(contents);
        if (metadata.name === moduleName) { packageRoot = directory; files.add(candidate); break; }
      }
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    if (!packageRoot) return null;
    const nodeTypes = path.join(packageRoot, 'src', 'node-types.json');
    if (fs.existsSync(nodeTypes)) files.add(nodeTypes);
    if (files.size > MAX_FILES || ![...files].some(file => file.endsWith('.node'))) return null;
    const digest = createHash('sha256'), buffer = Buffer.allocUnsafe(64 * 1024);
    let bytes = 0;
    for (const file of [...files].sort()) {
      const complete = withInstalledFile(file, descriptor => {
        const before = descriptor.stat();
        if (!before.isFile() || !Number.isSafeInteger(before.size) || before.size < 0 || before.size > MAX_BYTES - bytes) return false;
        bytes += before.size;
        digest.update(JSON.stringify([file.replaceAll('\\', '/'), before.size]));
        let offset = 0;
        while (offset < before.size) {
          const requested = Math.min(buffer.length, before.size - offset);
          const read = descriptor.read(buffer, 0, requested, offset);
          if (!Number.isSafeInteger(read) || read <= 0 || read > requested) return false;
          digest.update(buffer.subarray(0, read)); offset += read;
        }
        return unchanged(before, descriptor.stat());
      });
      if (!complete) return null;
    }
    return digest.digest('hex');
  } catch (error) { if (getContainedFileSession(error)) throw error; return null; }
};
