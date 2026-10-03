import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { isPathWithinRoot } from './file-paths.js';

const unsafePath = () => Object.assign(new Error('Path is outside its authorized root or contains a symlink.'), { code: 'ERR_UNSAFE_FILE_PATH' });

export const assertNoSymlinkPath = (root, target, { allowMissing = false } = {}) => {
  const lexicalRoot = path.resolve(root);
  const lexicalTarget = path.resolve(target);
  if (!isPathWithinRoot(lexicalTarget, lexicalRoot)) throw unsafePath();
  if (fs.lstatSync(lexicalRoot).isSymbolicLink()) throw unsafePath();
  const canonicalRoot = fs.realpathSync(lexicalRoot);
  let current = lexicalRoot;
  const parts = path.relative(lexicalRoot, lexicalTarget).split(path.sep).filter(Boolean);
  for (const part of parts) {
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw unsafePath();
      if (!isPathWithinRoot(fs.realpathSync(current), canonicalRoot)) throw unsafePath();
    } catch (error) {
      if (allowMissing && error.code === 'ENOENT') return lexicalTarget;
      throw error;
    }
  }
  return lexicalTarget;
};

const verifyHandle = (fd, root, target) => {
  assertNoSymlinkPath(root, target);
  const opened = fs.fstatSync(fd);
  const current = fs.statSync(target);
  if (!opened.isFile() || opened.dev !== current.dev || opened.ino !== current.ino) throw unsafePath();
  // Linux resolves the actual opened object, not the now mutable pathname.
  // Other platforms retain no-follow + canonical and descriptor-identity checks.
  if (process.platform === 'linux') {
    const actual = fs.realpathSync(`/proc/self/fd/${fd}`);
    if (!isPathWithinRoot(actual, fs.realpathSync(root))) throw unsafePath();
  }
};

const READ_FLAGS = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0);

export const openContainedFileSync = (root, target) => {
  assertNoSymlinkPath(root, target);
  const fd = fs.openSync(target, READ_FLAGS);
  try { verifyHandle(fd, root, target); } catch (error) { fs.closeSync(fd); throw error; }
  return fd;
};

export const openContainedFile = async (root, target) => {
  assertNoSymlinkPath(root, target);
  const handle = await fsPromises.open(target, READ_FLAGS);
  try { verifyHandle(handle.fd, root, target); } catch (error) { await handle.close(); throw error; }
  return handle;
};

export const readContainedFile = async (root, target, { expectedStat = null } = {}) => {
  const handle = await openContainedFile(root, target);
  try {
    const stat = await handle.stat();
    if (expectedStat && ['dev', 'ino', 'size'].some((key) => (
      Number.isFinite(expectedStat[key]) && expectedStat[key] !== stat[key]
    ))) throw Object.assign(new Error('Repository file changed after discovery.'), { code: 'ERR_FILE_CHANGED' });
    // Read only the opened descriptor's measured size, never an unbounded
    // pathname read that can grow while processing an adversarial repository.
    const buffer = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) {
      throw Object.assign(new Error('Repository file changed during read.'), { code: 'ERR_FILE_CHANGED' });
    }
    return buffer.subarray(0, offset);
  } finally { await handle.close(); }
};
