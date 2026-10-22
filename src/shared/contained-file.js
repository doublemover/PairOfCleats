import { withSchedulerCpuSuspended } from './concurrency/scheduler-task-scope.js';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { constants as bufferConstants } from 'node:buffer';
import { isPathWithinRoot } from './file-paths.js';
import { throwIfAborted } from './abort.js';

const unsafePath = () => Object.assign(new Error('Path is outside its authorized root or contains a symlink.'), { code: 'ERR_UNSAFE_FILE_PATH' });
// Native Windows canonicalization avoids JS walking every ancestor repeatedly.
// Keep the per-component no-symlink and descriptor checks below unchanged.
const realpathSync = process.platform === 'win32' ? fs.realpathSync.native : fs.realpathSync;

export const assertNoSymlinkPath = (root, target, { allowMissing = false } = {}) => {
  const lexicalRoot = path.resolve(root);
  const lexicalTarget = path.resolve(target);
  if (!isPathWithinRoot(lexicalTarget, lexicalRoot)) throw unsafePath();
  if (fs.lstatSync(lexicalRoot).isSymbolicLink()) throw unsafePath();
  const canonicalRoot = realpathSync(lexicalRoot);
  let current = lexicalRoot;
  const parts = path.relative(lexicalRoot, lexicalTarget).split(path.sep).filter(Boolean);
  for (const part of parts) {
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw unsafePath();
      if (!isPathWithinRoot(realpathSync(current), canonicalRoot)) throw unsafePath();
    } catch (error) {
      if (allowMissing && error.code === 'ENOENT') return lexicalTarget;
      throw error;
    }
  }
  return lexicalTarget;
};

const verifyHandle = (fd, root, target, expectedFileIdentity = null) => {
  assertNoSymlinkPath(root, target);
  const opened = fs.fstatSync(fd, { bigint: true });
  const current = fs.statSync(target, { bigint: true });
  if (opened.isDirectory()) {
    throw Object.assign(new Error('Repository path is a directory.'), { code: 'EISDIR' });
  }
  if (!opened.isFile() || opened.dev !== current.dev || opened.ino !== current.ino) throw unsafePath();
  if (expectedFileIdentity && (opened.dev.toString() !== expectedFileIdentity.dev
    || opened.ino.toString() !== expectedFileIdentity.ino)) throw changedFile();
  // Linux resolves the actual opened object, not the now mutable pathname.
  // Other platforms retain no-follow + canonical and descriptor-identity checks.
  if (process.platform === 'linux') {
    const actual = fs.realpathSync(`/proc/self/fd/${fd}`);
    if (!isPathWithinRoot(actual, fs.realpathSync(root))) throw unsafePath();
  }
  return opened;
};

/** Recheck a retained opened object before committing streamed verification. */
export const verifyContainedFileHandle = (handleOrFd, root, target) => {
  const fd = typeof handleOrFd === 'number' ? handleOrFd : handleOrFd?.fd;
  verifyHandle(fd, root, target);
};

const READ_FLAGS = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0);

export const openContainedFileSync = (root, target, { expectedFileIdentity = null } = {}) => {
  const identity = normalizeFileIdentity(expectedFileIdentity);
  assertNoSymlinkPath(root, target);
  const fd = fs.openSync(target, READ_FLAGS);
  try { verifyHandle(fd, root, target, identity); } catch (error) { fs.closeSync(fd); throw error; }
  return fd;
};

export const openContainedFile = async (root, target, { expectedFileIdentity = null } = {}) => {
  const identity = normalizeFileIdentity(expectedFileIdentity);
  assertNoSymlinkPath(root, target);
  const handle = await withSchedulerCpuSuspended(() => fsPromises.open(target, READ_FLAGS));
  try { verifyHandle(handle.fd, root, target, identity); } catch (error) { await withSchedulerCpuSuspended(() => handle.close()); throw error; }
  return handle;
};

const changedFile = () => Object.assign(new Error('Repository file changed during its verified read.'), { code: 'ERR_FILE_CHANGED' });
const identityKeys = ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'];
const normalizeFileIdentity = (value) => {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Object.keys(value).length !== 2 || !Object.hasOwn(value, 'dev') || !Object.hasOwn(value, 'ino')
    || !['dev', 'ino'].every(key => typeof value[key] === 'string' && /^[0-9]{1,32}$/.test(value[key]))) {
    throw new TypeError('Invalid exact opened-file identity.');
  }
  return Object.freeze({ dev: value.dev, ino: value.ino });
};
const normalizeReadOptions = ({ maxBytes = 64 * 1024 * 1024, expectedBytes = null,
  expectedHash = null, hashAlgorithm = 'sha256', expectedStat = null, expectedFileIdentity = null,
  signal = null, metrics = null } = {}) => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > bufferConstants.MAX_LENGTH) {
    throw new TypeError('A verified read requires a bounded nonnegative maxBytes.');
  }
  if (expectedBytes !== null && (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0)) {
    throw new TypeError('Invalid verified file byte identity.');
  }
  if (!['sha256', 'sha1'].includes(hashAlgorithm)) throw new TypeError('Unsupported file hash algorithm.');
  const hash = expectedHash === null ? null : String(expectedHash).replace(new RegExp(`^${hashAlgorithm}:`), '');
  if (hash !== null && !new RegExp(`^[a-f0-9]{${hashAlgorithm === 'sha256' ? 64 : 40}}$`, 'i').test(hash)) {
    throw new TypeError('Invalid verified file hash identity.');
  }
  return { maxBytes, expectedBytes, expectedHash: hash?.toLowerCase() ?? null,
    hashAlgorithm, expectedStat, expectedFileIdentity: normalizeFileIdentity(expectedFileIdentity), signal, metrics };
};
const admitRead = (stat, options) => {
  throwIfAborted(options.signal);
  if (!Number.isSafeInteger(stat.size) || stat.size < 0 || stat.size > options.maxBytes) {
    throw Object.assign(new Error('Contained file exceeds its read byte allowance.'), { code: 'ERR_FILE_TOO_LARGE' });
  }
  if (options.expectedBytes !== null && stat.size !== options.expectedBytes) throw changedFile();
  if (options.expectedStat && identityKeys.some((key) => Number.isFinite(options.expectedStat[key])
    && options.expectedStat[key] !== stat[key])) throw changedFile();
};
const finishRead = (fd, root, target, before, after, buffer, bytesRead, options) => {
  throwIfAborted(options.signal);
  const opened = verifyHandle(fd, root, target, options.expectedFileIdentity);
  if (bytesRead !== before.size || identityKeys.some((key) => before[key] !== after[key])) throw changedFile();
  const hash = createHash(options.hashAlgorithm).update(buffer).digest('hex');
  if (options.metrics) options.metrics.verificationBytes = (options.metrics.verificationBytes || 0) + bytesRead;
  if (options.expectedHash !== null && hash !== options.expectedHash) {
    throw Object.assign(new Error('Contained file checksum does not match its pinned identity.'), { code: 'ERR_FILE_INTEGRITY' });
  }
  const result = { buffer, hash, stat: after };
  // Exact descriptor identity is internal read authority, not serialized output.
  Object.defineProperty(result, 'fileIdentity', {
    value: Object.freeze({ dev: opened.dev.toString(), ino: opened.ino.toString() })
  });
  return result;
};

/** The returned bytes are exactly the bounded, contained descriptor bytes hashed here. */
export const readVerifiedContainedFile = async (root, target, inputOptions = {}) => {
  const options = normalizeReadOptions(inputOptions);
  throwIfAborted(options.signal);
  const handle = await openContainedFile(root, target, options);
  try {
    const stat = await withSchedulerCpuSuspended(() => handle.stat());
    admitRead(stat, options);
    const buffer = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < buffer.length) {
      throwIfAborted(options.signal);
      const { bytesRead } = await withSchedulerCpuSuspended(() => handle.read(buffer, offset, Math.min(65536, buffer.length - offset), offset));
      if (!bytesRead) break;
      offset += bytesRead;
    }
    return finishRead(handle.fd, root, target, stat, await withSchedulerCpuSuspended(() => handle.stat()), buffer, offset, options);
  } finally { await withSchedulerCpuSuspended(() => handle.close()); }
};

export const readVerifiedContainedFileSync = (root, target, inputOptions = {}) => {
  const options = normalizeReadOptions(inputOptions);
  throwIfAborted(options.signal);
  const fd = openContainedFileSync(root, target, options);
  try {
    const stat = fs.fstatSync(fd);
    admitRead(stat, options);
    const buffer = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < buffer.length) {
      throwIfAborted(options.signal);
      const bytesRead = fs.readSync(fd, buffer, offset, Math.min(65536, buffer.length - offset), offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    return finishRead(fd, root, target, stat, fs.fstatSync(fd), buffer, offset, options);
  } finally { fs.closeSync(fd); }
};

export const readContainedFile = async (root, target, options = {}) => (
  (await readVerifiedContainedFile(root, target, options)).buffer
);
