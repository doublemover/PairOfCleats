import { recordVerifiedArtifactRead } from './artifact-io/verified-read-scope.js';
import { withSchedulerCpuSuspended } from './concurrency/scheduler-task-scope.js';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { constants as bufferConstants } from 'node:buffer';
import { isPathWithinRoot } from './file-paths.js';
import { throwIfAborted } from './abort.js';
import { createContainedFileResource, iterateContainedFileResource, iterateContainedFileResourceSync } from './contained-file-resource.js';
import { addStorageFailureContext } from './storage/operation-error.js';
export { isContainedFileSession, getContainedFileSession } from './contained-file-resource.js';

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

const verifyHandle = (fd, root, target, expectedFileIdentity = null,
  methods = { fstat: fs.fstatSync, stat: fs.statSync }) => {
  assertNoSymlinkPath(root, target);
  const opened = methods.fstat.call(fs, fd, { bigint: true });
  const current = methods.stat.call(fs, target, { bigint: true });
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

const acquireContainedFileSync = (root, target, { expectedFileIdentity = null } = {}) => {
  const identity = normalizeFileIdentity(expectedFileIdentity);
  const methods = { receiver: fs, close: fs.closeSync, stat: fs.fstatSync, read: fs.readSync };
  const verification = { fstat: methods.stat, stat: fs.statSync };
  assertNoSymlinkPath(root, target);
  const fd = fs.openSync(target, READ_FLAGS);
  const owner = createContainedFileResource({ fd, sync: true, methods });
  if (owner.hasFailure()) return owner.runSync(() => {});
  try {
    verifyHandle(fd, root, target, identity, verification);
  } catch (error) { owner.remember(error); return owner.runSync(() => {}); }
  return { owner, verification, identity };
};

const acquireContainedFile = async (root, target, { expectedFileIdentity = null } = {}) => {
  const identity = normalizeFileIdentity(expectedFileIdentity);
  const verification = { fstat: fs.fstatSync, stat: fs.statSync };
  assertNoSymlinkPath(root, target);
  const openMethod = fsPromises.open;
  let opening = null, handle = null, failure, secondary, failed = false, secondaryPresent = false;
  try {
    await withSchedulerCpuSuspended(() => {
      opening = Promise.resolve().then(() => openMethod.call(fsPromises, target, READ_FLAGS));
      return opening;
    });
  } catch (value) { failed = true; failure = value; }
  if (opening) {
    try { handle = await opening; }
    catch (value) {
      if (!failed) { failed = true; failure = value; }
      else if (value !== failure) { secondaryPresent = true; secondary = value; }
    }
  }
  if (!handle) {
    if (!failed) throw new Error('Scheduler wait did not return the actual opened contained descriptor.');
    if (secondaryPresent) throw addStorageFailureContext(failure, {}, secondary, { secondaryPresent: true });
    throw failure;
  }
  const owner = createContainedFileResource({ handle, sync: false });
  if (failed) owner.remember(failure);
  if (secondaryPresent) owner.remember(secondary);
  if (owner.hasFailure()) return owner.run(() => {});
  try {
    verifyHandle(owner.operations.fd, root, target, identity, verification);
  } catch (error) { owner.remember(error); return owner.run(() => {}); }
  return { owner, verification, identity };
};

/** Legacy successful open transfers its descriptor to the caller. Failed
 * admission remains with the actual original owner until close is confirmed.
 */
export const openContainedFileSync = (root, target, options = {}) => acquireContainedFileSync(root, target, options).owner.detach();
export const openContainedFile = async (root, target, options = {}) => (await acquireContainedFile(root, target, options)).owner.detach();

/** Borrow immutable original operations only during this callback. No read,
 * stat, payload or witness is replayed by a failed-close recovery capability.
 */
export const withContainedFile = async (root, target, action, options = {}) => {
  if (typeof action !== 'function') throw new TypeError('Contained file requires its read callback.');
  const { owner, verification, identity } = await acquireContainedFile(root, target, options);
  const descriptor = Object.freeze({ ...owner.operations,
    verify: () => owner.inspect(fd => verifyHandle(fd, root, target, identity, verification)) });
  return owner.run(() => action(descriptor, Object.freeze({ isSettled: owner.isSettled })));
};

export const withContainedFileSync = (root, target, action, options = {}) => {
  if (typeof action !== 'function') throw new TypeError('Contained file requires its synchronous read callback.');
  const { owner, verification, identity } = acquireContainedFileSync(root, target, options);
  const descriptor = Object.freeze({ ...owner.operations,
    verify: () => owner.inspect(fd => verifyHandle(fd, root, target, identity, verification)) });
  return owner.runSync(() => action(descriptor));
};

/** Borrow lazily across synchronous generator yields. Normal exhaustion invokes
 * onComplete only after confirmed close; return/throw and recovery do not.
 */
export const iterateContainedFileSync = (root, target, action, { onComplete = null, ...options } = {}) => {
  if (typeof action !== 'function') throw new TypeError('Contained file requires its synchronous generator callback.');
  if (onComplete !== null && typeof onComplete !== 'function') throw new TypeError('Invalid contained iterator completion callback.');
  return iterateContainedFileResourceSync(() => {
    const { owner, verification, identity } = acquireContainedFileSync(root, target, options);
    const descriptor = Object.freeze({ ...owner.operations,
      verify: () => owner.inspect(fd => verifyHandle(fd, root, target, identity, verification)) });
    return { owner, action: () => action(descriptor), onComplete };
  });
};

export const iterateContainedFile = (root, target, action, { onComplete = null, ...options } = {}) => {
  if (typeof action !== 'function') throw new TypeError('Contained file requires its async generator callback.');
  if (onComplete !== null && typeof onComplete !== 'function') throw new TypeError('Invalid contained iterator completion callback.');
  return iterateContainedFileResource(async () => {
    const { owner, verification, identity } = await acquireContainedFile(root, target, options);
    const descriptor = Object.freeze({ ...owner.operations,
      verify: () => owner.inspect(fd => verifyHandle(fd, root, target, identity, verification)) });
    return { owner, action: () => action(descriptor), onComplete };
  });
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
const finishRead = (fd, root, target, before, after, buffer, bytesRead, options, verification) => {
  throwIfAborted(options.signal);
  const opened = verifyHandle(fd, root, target, options.expectedFileIdentity, verification);
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
  const { owner, verification } = await acquireContainedFile(root, target, options);
  const result = await owner.run(async descriptor => {
    // Admission already captures this exact native fd-stat operation. Keep
    // fresh before/after metadata without dispatching redundant async stats;
    // payload reads and closure retain their original asynchronous owner.
    const stat = verification.fstat.call(fs, descriptor.fd);
    admitRead(stat, options);
    const buffer = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < buffer.length) {
      throwIfAborted(options.signal);
      const { bytesRead } = await descriptor.read(buffer, offset, Math.min(65536, buffer.length - offset), offset);
      if (!Number.isInteger(bytesRead) || bytesRead < 0 || bytesRead > Math.min(65536, buffer.length - offset)) throw changedFile();
      if (!bytesRead) break;
      offset += bytesRead;
    }
    return finishRead(descriptor.fd, root, target, stat, verification.fstat.call(fs, descriptor.fd), buffer, offset, options, verification);
  });
  recordVerifiedArtifactRead(root, target, result, options.hashAlgorithm);
  return result;
};

export const readVerifiedContainedFileSync = (root, target, inputOptions = {}) => {
  const options = normalizeReadOptions(inputOptions);
  throwIfAborted(options.signal);
  const { owner, verification } = acquireContainedFileSync(root, target, options);
  const result = owner.runSync(descriptor => {
    const stat = descriptor.stat();
    admitRead(stat, options);
    const buffer = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < buffer.length) {
      throwIfAborted(options.signal);
      const bytesRead = descriptor.read(buffer, offset, Math.min(65536, buffer.length - offset), offset);
      if (!Number.isInteger(bytesRead) || bytesRead < 0 || bytesRead > Math.min(65536, buffer.length - offset)) throw changedFile();
      if (!bytesRead) break;
      offset += bytesRead;
    }
    return finishRead(descriptor.fd, root, target, stat, descriptor.stat(), buffer, offset, options, verification);
  });
  recordVerifiedArtifactRead(root, target, result, options.hashAlgorithm);
  return result;
};

export const readContainedFile = async (root, target, options = {}) => (
  (await readVerifiedContainedFile(root, target, options)).buffer
);
