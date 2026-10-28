import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildCacheKey } from '../../../shared/cache-key.js';
import { isAbsolutePathAny, toPosix } from '../../../shared/file-paths.js';
import { isPathUnderDir } from '../../../shared/path-normalize.js';
import { assertNoSymlinkPath, withContainedFile } from '../../../shared/contained-file.js';
import { atomicWriteText } from '../../../shared/io/atomic-write.js';
import { describeStorageFailure, observeStorageResource } from '../../../shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../../shared/storage/operation-error.js';
import { acquireNativeReaderStorage, findNativeReaderStorage, registerNativeReaderStorage } from '../../../shared/storage/native-reader.js';
import { ensureToolingCacheDir } from '../cache-storage.js';

const VFS_DISK_CACHE = new Map();
const VFS_DISK_CACHE_MAX_ENTRIES = 50_000;
const pendingMaterializations = new Map();
const consumerSessions = new WeakMap();
const canonicalPathKey = value => process.platform === 'win32' ? path.toNamespacedPath(value).toLowerCase() : value;
const ownerSettled = owner => {
  try { return owner.finished && !owner.consumers.size && (!owner.failureObservation || owner.failureObservation.isSettled()); }
  catch { return false; }
};

const rememberOwnerFailure = (owner, error) => {
  const context = owner.failureObservation
    ? addStorageFailureContext(owner.failureObservation.retain(), {}, error, { secondaryPresent: true }) : error;
  owner.failureObservation = observeStorageResource(observeStorageResource(context, { phase: 'vfs-materialization-owner' }).retain(),
    { phase: 'vfs-materialization-owner' });
  if (!pendingMaterializations.has(owner.key) && !ownerSettled(owner)) pendingMaterializations.set(owner.key, owner);
};

/** The existing provider session supplies its captured original closure
 * predicate. Retirement prevents new admission; only confirmed client closure
 * and every started materialization allow these in-process pins to retire.
 * Optional canonical storage admission reuses the existing native-reader
 * category/resource owner. This grants no file removal or external authority.
 */
export const createVfsMaterializationSession = ({ isClosed }) => {
  if (typeof isClosed !== 'function') throw new TypeError('VFS consumer requires its original client closure observer.');
  const state = { owners: new Set(), storage: new Set(), admissionFailures: [], admissionError: null,
    admissionFailed: false, retiring: false, released: false };
  const closure = observeStorageResource(observeStorageResource(Object.freeze({ cacheOwnershipPending: true,
    cacheOwnershipReleased: () => isClosed() === true }), { phase: 'vfs-consumer-client' }).retain(), { phase: 'vfs-consumer-client' });
  const session = Object.freeze({
    get size() { return state.owners.size; },
    get storageRootCount() { return state.storage.size; },
    admitRoot(baseDir, context) {
      if (state.retiring || state.released) throw new TypeError('Retired VFS consumers cannot acquire storage.');
      if (state.admissionFailed) throw state.admissionError;
      if (!context) return false;
      for (const observation of state.admissionFailures) observation.requireSettled();
      const target = path.resolve(baseDir);
      let admission;
      try {
        if (findNativeReaderStorage(session, target, context)) return true;
        admission = acquireNativeReaderStorage(target, context, () => state.retiring && closure.isSettled()
          && [...state.owners].every(owner => owner.finished && (!owner.failureObservation || owner.failureObservation.isSettled())));
        if (!admission) return false; // External roots acquire no guessed authority.
        state.storage.add(admission);
        admission.start(); registerNativeReaderStorage(session, admission);
        return true;
      } catch (error) {
        state.admissionFailed = true; state.admissionError = error;
        // Partial metadata admission already exposes its exact existing owner.
        // Keep it reachable through this same consumer, without dispatch/replay.
        if (!admission) state.admissionFailures.push(observeStorageResource(
          observeStorageResource(error, { phase: 'vfs-consumer-storage-admission' }).retain(), { phase: 'vfs-consumer-storage-admission' }));
        throw error;
      }
    },
    retire() { state.retiring = true; },
    releaseAfterClosure() {
      state.retiring = true;
      if (state.released) return true;
      try {
        if (state.owners.size || state.storage.size) closure.requireSettled();
        for (const observation of state.admissionFailures) observation.requireSettled();
        for (const owner of state.owners) {
          owner.failureObservation?.requireSettled();
          if (!owner.finished) throw Object.assign(new Error('Original VFS publication remains outstanding.'), {
            cacheOwnershipPending: true, cacheOwnershipReleased: () => owner.finished
          });
        }
        let failure, failed = false;
        for (const admission of state.storage) {
          try { admission.releaseAfterClosure(); }
          catch (error) {
            failure = failed ? addStorageFailureContext(failure, {}, error, { secondaryPresent: true }) : error;
            failed = true;
          }
        }
        if (failed) throw failure;
      } catch (error) {
        throw addStorageFailureContext(error, { vfsMaterializationSession: session }, null,
          { forceAggregate: true, nonEnumerable: ['vfsMaterializationSession'] });
      }
      for (const owner of state.owners) {
        owner.consumers.delete(state);
        if (ownerSettled(owner) && pendingMaterializations.get(owner.key) === owner) pendingMaterializations.delete(owner.key);
      }
      state.owners.clear(); state.released = true; return true;
    }
  });
  consumerSessions.set(session, state);
  return session;
};

const pinConsumer = (owner, session) => {
  if (session === null) return;
  const state = consumerSessions.get(session);
  if (!state || state.retiring || state.released) throw new TypeError('VFS materialization requires its active original consumer session.');
  if (state.admissionFailed) throw state.admissionError;
  owner.consumers.add(state); state.owners.add(owner);
};

export const createVfsMaterializationConflict = (virtualPath, owner = null) => Object.assign(
  new Error(`Concurrent VFS materializations disagree on content for ${virtualPath}.`), {
    code: 'ERR_VFS_MATERIALIZATION_CONFLICT',
    ...(owner ? { cacheOwnershipPending: true, cacheOwnershipReleased: () => ownerSettled(owner) } : {})
  });

const statIdentity = stat => Object.freeze(Object.fromEntries(['dev', 'ino', 'size', 'nlink', 'mtimeNs', 'ctimeNs', 'birthtimeNs']
  .map(key => [key, String(stat[key])])));
const sameIdentity = (left, right) => left && right && Object.keys(left).every(key => left[key] === right[key]);

/** Mutable project-relative documents retain their existing paths. Reuse is
 * qualified at a current contained descriptor observation, not a permanent
 * claim that an external writer cannot change that path after return. */
const qualifyMaterialization = async ({ baseDir, absPath, bytes, hash, prior = null }) => {
  try {
    return await withContainedFile(baseDir, absPath, async descriptor => {
      const before = await descriptor.stat({ bigint: true });
      if (!before.isFile() || before.nlink !== 1n || before.size !== BigInt(bytes)) return null;
      const identity = statIdentity(before);
      if (prior?.hash === hash && sameIdentity(prior.identity, identity)) {
        descriptor.verify(); return { identity, hash, verificationBytes: 0, verification: 'unchanged-opened-file-identity' };
      }
      const checksum = createHash('sha256'), buffer = Buffer.alloc(Math.min(65536, bytes));
      let offset = 0;
      while (offset < bytes) {
        const count = Math.min(buffer.length, bytes - offset);
        const { bytesRead } = await descriptor.read(buffer, 0, count, offset);
        if (!Number.isInteger(bytesRead) || bytesRead <= 0 || bytesRead > count) throw new Error('VFS verification made invalid read progress.');
        checksum.update(buffer.subarray(0, bytesRead)); offset += bytesRead;
      }
      const after = statIdentity(await descriptor.stat({ bigint: true })); descriptor.verify();
      if (!sameIdentity(identity, after) || checksum.digest('hex') !== hash) return null;
      return { identity, hash, verificationBytes: offset, verification: 'sha256-opened-file-content' };
    });
  } catch (error) {
    if (describeStorageFailure(error, { phase: 'vfs-materialization-qualification' }).code === 'ENOENT') return null;
    throw error;
  }
};

const setVfsDiskCacheEntry = (key, value) => {
  if (!key) return;
  if (VFS_DISK_CACHE.has(key)) VFS_DISK_CACHE.delete(key);
  VFS_DISK_CACHE.set(key, value);
  while (VFS_DISK_CACHE.size > VFS_DISK_CACHE_MAX_ENTRIES) {
    const oldestKey = VFS_DISK_CACHE.keys().next().value;
    if (oldestKey == null) break;
    VFS_DISK_CACHE.delete(oldestKey);
  }
};

const buildVfsDiskCacheKey = ({ baseDir, virtualPath }) => buildCacheKey({
  repoHash: baseDir || '',
  buildConfigHash: null,
  mode: 'vfs',
  schemaVersion: 'vfs-disk-cache-v1',
  featureFlags: null,
  pathPolicy: 'posix',
  extra: { virtualPath: virtualPath || '' }
}).key;

/**
 * Resolve a safe disk path for a virtual path under a base directory.
 * @param {{baseDir:string,virtualPath:string}} input
 * @returns {string}
 */
export const resolveVfsDiskPath = ({ baseDir, virtualPath }) => {
  const baseRaw = String(baseDir || '').trim();
  if (!baseRaw) {
    throw new Error('VFS baseDir is required.');
  }
  const rootDir = path.resolve(baseRaw);
  const encodeUnsafeChar = (ch) => {
    const hex = ch.codePointAt(0).toString(16).toUpperCase().padStart(2, '0');
    return `%${hex}`;
  };
  const rawPath = toPosix(String(virtualPath || '').trim());
  if (!rawPath) {
    throw new Error('VFS virtualPath is required.');
  }
  if (isAbsolutePathAny(rawPath)) {
    throw new Error(`VFS virtualPath must be relative: ${virtualPath}`);
  }
  const parts = rawPath.split('/').filter((part) => part.length > 0);
  if (!parts.length) {
    throw new Error(`VFS virtualPath is invalid: ${virtualPath}`);
  }
  const safeParts = parts.map((part) => {
    if (part === '.' || part === '..') {
      throw new Error(`VFS virtualPath must not escape the baseDir: ${virtualPath}`);
    }
    return part.replace(/[:*?"<>|/\\]/g, (ch) => encodeUnsafeChar(ch));
  });
  const relative = safeParts.join(path.sep);
  const resolvedPath = path.resolve(rootDir, relative);
  if (!isPathUnderDir(rootDir, resolvedPath)) {
    throw new Error(`VFS virtualPath resolves outside baseDir: ${virtualPath}`);
  }
  return resolvedPath;
};

/**
 * Ensure a VFS-backed document exists on disk; avoid rewrites when the doc hash matches.
 * @param {{baseDir:string,virtualPath:string,text?:string,docHash?:string|null,coldStartCache?:{get?:Function,set?:Function}|null,materializationSession?:object|null}} input
 * @returns {Promise<{path:string,cacheHit:boolean,source?:string}>}
 */
export const ensureVfsDiskDocument = async ({
  baseDir,
  virtualPath,
  text = '',
  docHash = null,
  coldStartCache = null,
  materializationSession = null
}) => {
  if (typeof text !== 'string') throw new TypeError('VFS disk text must be a string.');
  const resolvedDocHash = typeof docHash === 'string' && docHash.trim().length > 0
    ? docHash.trim()
    : null;
  const absPath = resolveVfsDiskPath({ baseDir, virtualPath });
  const root = path.resolve(baseDir), key = canonicalPathKey(absPath);
  const cacheKey = buildVfsDiskCacheKey({ baseDir: canonicalPathKey(root), virtualPath });
  const bytes = Buffer.byteLength(text, 'utf8'), hash = createHash('sha256').update(text, 'utf8').digest('hex');
  let owner = pendingMaterializations.get(key);
  if (owner?.finished) {
    owner.failureObservation?.requireSettled();
    if (ownerSettled(owner)) { pendingMaterializations.delete(key); owner = null; }
  }
  if (owner && (owner.hash !== hash || owner.docHash !== resolvedDocHash)) throw createVfsMaterializationConflict(virtualPath, owner);
  const retainedPublication = owner?.finished === true;
  if (!owner) {
    owner = { key, hash, docHash: resolvedDocHash, finished: false, failureObservation: null, promise: null, consumers: new Set() };
    pinConsumer(owner, materializationSession);
    pendingMaterializations.set(key, owner);
    owner.promise = (async () => {
      try {
        ensureToolingCacheDir(root);
        const cachedPath = resolvedDocHash && coldStartCache?.get
          ? coldStartCache.get({ virtualPath, docHash: resolvedDocHash, expectedPath: absPath }) : null;
        const coldCandidate = typeof cachedPath === 'string' && canonicalPathKey(path.resolve(cachedPath)) === key;
        const cached = VFS_DISK_CACHE.get(cacheKey);
        const prior = cached?.docHash === resolvedDocHash ? cached : null;
        const qualified = resolvedDocHash ? await qualifyMaterialization({ baseDir: root, absPath, bytes, hash, prior }) : null;
        if (qualified) {
          setVfsDiskCacheEntry(cacheKey, { path: absPath, docHash: resolvedDocHash, ...qualified });
          return Object.freeze({ path: absPath, cacheHit: true, source: qualified.verification === 'unchanged-opened-file-identity' && prior ? 'memory'
            : coldCandidate ? 'cold-start' : 'existing-verified',
          materialization: Object.freeze({ version: 1, baseDir: root, virtualPath, docHash: resolvedDocHash,
            sha256: hash, sizeBytes: bytes, ...qualified, policy: 'mutable-path-current-descriptor' }) });
        }
        ensureToolingCacheDir(path.dirname(absPath));
        assertNoSymlinkPath(root, absPath, { allowMissing: true });
        await atomicWriteText(absPath, text, { mkdir: false,
          beforeCommit: () => assertNoSymlinkPath(root, absPath, { allowMissing: true }) });
        const published = await qualifyMaterialization({ baseDir: root, absPath, bytes, hash });
        if (!published) throw Object.assign(new Error('Published VFS content changed before qualification.'), { code: 'ERR_VFS_MATERIALIZATION_CHANGED' });
        setVfsDiskCacheEntry(cacheKey, { path: absPath, docHash: resolvedDocHash, ...published });
        return Object.freeze({ path: absPath, cacheHit: false, source: prior || coldCandidate ? 'regenerated' : 'created',
          materialization: Object.freeze({ version: 1, baseDir: root, virtualPath, docHash: resolvedDocHash,
            sha256: hash, sizeBytes: bytes, ...published, policy: 'mutable-path-current-descriptor' }) });
      } catch (error) {
        rememberOwnerFailure(owner, error); throw error;
      } finally {
        owner.finished = true;
        if (ownerSettled(owner) && pendingMaterializations.get(key) === owner) pendingMaterializations.delete(key);
      }
    })();
  } else pinConsumer(owner, materializationSession);
  let result = await owner.promise;
  if (retainedPublication) {
    let qualified;
    try { qualified = await qualifyMaterialization({ baseDir: root, absPath, bytes, hash, prior: VFS_DISK_CACHE.get(cacheKey) }); }
    catch (error) { rememberOwnerFailure(owner, error); throw error; }
    if (!qualified) throw Object.assign(new Error('Active provider VFS content changed; replacement awaits original consumer closure.'), {
      code: 'ERR_VFS_MATERIALIZATION_CHANGED', cacheOwnershipPending: true, cacheOwnershipReleased: () => ownerSettled(owner)
    });
    setVfsDiskCacheEntry(cacheKey, { path: absPath, docHash: resolvedDocHash, ...qualified });
    result = Object.freeze({ ...result, cacheHit: true, source: 'existing-verified',
      materialization: Object.freeze({ ...result.materialization, ...qualified }) });
  }
  if (resolvedDocHash && coldStartCache?.set) {
    try { coldStartCache.set({
      virtualPath,
      docHash: resolvedDocHash,
      diskPath: result.path,
      sizeBytes: bytes,
      materialization: result.materialization
    }); } catch (error) { rememberOwnerFailure(owner, error); throw error; }
  }
  return result;
};
