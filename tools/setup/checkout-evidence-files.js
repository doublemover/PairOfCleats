import fs from 'node:fs';
import path from 'node:path';
import { createContainedFileResource } from '../../src/shared/contained-file-resource.js';
import { assertDirectoryIdentity } from '../../src/shared/io/directory-sync.js';
import { persistenceFileIdentity, assertPersistenceFileIdentity } from '../../src/shared/io/file-identity.js';
import { createStorageObservationLedger } from '../../src/shared/storage/failure-observation.js';
import { requireCheckoutMutationSession, retainCheckoutMutationPrerequisite, withCheckoutMutation } from './checkout-mutation.js';
import { CHECKOUT_NATIVE_EVIDENCE_LIMITS } from './checkout-bootstrap-paths.js';
import { CHECKOUT_EVIDENCE_LIMITS, captureEvidenceParents, readEvidenceFile } from './checkout-evidence-records.js';

const groups = new WeakMap();
const ioCaptures = new WeakMap(), nativeOpen = fs.openSync;
const LIMIT = 1024; // One journal plus two streams for each of 384 native attempts.
const failure = message => Object.assign(new Error(message), { code: 'ERR_CHECKOUT_EVIDENCE_FILE' });
const admitted = /^(?:\.tmp\/checkout-bootstrap\/j-[a-zA-Z0-9_-]{6,32}\/stages\.jsonl|\.tmp\/checkout-bootstrap\/logs\/n-[a-zA-Z0-9_-]{6,32}\/\d{3}\.(?:stdout|stderr))$/;
const requireProducerBytes = expected => {
  if (!Number.isSafeInteger(expected?.bytes) || expected.bytes < 0 || expected.bytes > CHECKOUT_EVIDENCE_LIMITS.fileBytes
    || typeof expected.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(expected.sha256)) throw failure('Evidence requires its original producer byte extent and hash.');
};

/** Method/receiver capture only, not permission to open a path. A clone cannot
 * stand in for this original provider snapshot after async admission. */
export const captureCheckoutEvidenceIO = io => {
  if (ioCaptures.has(io)) return io;
  if (!io || !['object', 'function'].includes(typeof io)) throw new TypeError('Evidence IO requires an original provider.');
  const captured = { receiver: io };
  for (const field of ['openSync', 'fstatSync', 'readSync', 'closeSync', 'writeSync', 'fsyncSync']) {
    const method = io[field];
    if (typeof method !== 'function') throw new TypeError('Evidence IO requires its original ' + field + ' method.');
    captured[field] = method;
  }
  const token = Object.freeze({ kind: 'checkout-evidence-io-capture' }); ioCaptures.set(token, Object.freeze(captured)); return token;
};

/** Original contained descriptors, aggregated once under their checkout owner.
 * Paths/identities are comparison data; copied metadata grants no IO authority.
 * This group never closes a caller's descriptor or infers child retirement.
 */
export const getCheckoutEvidenceFiles = (root, session) => {
  requireCheckoutMutationSession(root, session); root = session.root;
  if (groups.has(session)) return groups.get(session);
  const owners = [], files = new Map(), operations = new Set(), ownFailures = new WeakSet(), observations = createStorageObservationLedger({ isOwnFailure: error => ownFailures.has(error) });
  let opening = false, unknownOpen = false, nativeAttempts = 0, metadataBytes = 0, rawBytes = 0, reservedRawBytes = 0;
  const settledExcept = excluded => !opening && !unknownOpen && operations.size === 0
    && owners.every(owner => owner === excluded || owner.isSettled()) && observations.isSettled();
  const isSettled = () => settledExcept(null);
  const unknown = message => {
    const error = Object.assign(failure(message), { cacheOwnershipPending: true, cacheOwnershipReleased: isSettled });
    ownFailures.add(error); return error;
  };
  retainCheckoutMutationPrerequisite(root, session, isSettled);
  const nativeBudget = () => Object.freeze({ attempts: nativeAttempts, metadataBytes, rawBytes, reservedRawBytes,
    retainedBytes: metadataBytes + rawBytes + reservedRawBytes, limits: CHECKOUT_NATIVE_EVIDENCE_LIMITS });
  const group = Object.freeze({ isSettled, nativeBudget,
    requireSettled: () => { if (!isSettled()) throw unknown('Original checkout evidence work remains unretired.'); },
    requireOtherResourcesSettled: owner => {
      if (!owners.includes(owner)) throw new TypeError('Evidence finalization requires its actual original writer.');
      if (!settledExcept(owner)) throw unknown('Independent checkout evidence work remains unretired before journal close.');
    },
    run: operation => {
      requireCheckoutMutationSession(root, session);
      const pending = withCheckoutMutation(root, operation, { session }); operations.add(pending);
      pending.then(() => operations.delete(pending), error => { operations.delete(pending); observations.remember(error); });
      return pending;
    },
    sealClosed: (file, expected) => {
      requireCheckoutMutationSession(root, session);
      requireProducerBytes(expected);
      const relative = path.relative(session.root, path.resolve(file)).replaceAll('\\', '/'), original = files.get(relative);
      if (!original?.owner?.isSettled() || original.record) throw failure('Evidence sealing requires its original closed descriptor.');
      const identity = persistenceFileIdentity(fs.lstatSync(file, { bigint: true }));
      if (['dev', 'ino', 'mode', 'nlink', 'birthtime'].some(key => identity[key] !== original.identity[key])) throw failure('Evidence original file changed at close.');
      original.record = readEvidenceFile(root, { ...expected, path: relative, identity }, original.parents);
    },
    registerPublished: (file, expected) => {
      requireCheckoutMutationSession(root, session);
      requireProducerBytes(expected);
      const relative = path.relative(session.root, path.resolve(file)).replaceAll('\\', '/');
      if (!/^(?:\.tmp\/checkout-bootstrap\/j-[a-zA-Z0-9_-]{6,32}\/(?:prior-readiness|result)\.json|\.tmp\/checkout-bootstrap\/logs\/n-[a-zA-Z0-9_-]{6,32}\/\d{3}\.json)$/.test(relative)
        || files.has(relative) || files.size >= 1536) throw failure('Published evidence requires its exact unique original destination.');
      const original = relative.includes('/logs/') ? relative.slice(0, -5) + '.stdout'
        : path.posix.dirname(relative) + '/stages.jsonl';
      if (!files.get(original)?.owner) throw failure('Published metadata requires its original checkout-owned stream or journal writer.');
      const parents = captureEvidenceParents(root, relative), identity = persistenceFileIdentity(fs.lstatSync(file, { bigint: true }));
      const record = readEvidenceFile(root, { ...expected, path: relative, identity }, parents);
      files.set(relative, { record, parents });
    },
    closedFiles: () => {
      requireCheckoutMutationSession(root, session);
      if (!isSettled()) throw unknown('An original evidence descriptor or child remains unretired.');
      const records = [], parents = new Map();
      for (const original of files.values()) {
        if (!original.record) throw failure('Closed evidence requires its original producer byte extent and hash.');
        records.push(readEvidenceFile(root, original.record, original.parents));
        for (const row of original.parents) parents.set(row.path, row);
      }
      if (!isSettled()) throw unknown('Original evidence work changed during closed-file capture.');
      requireCheckoutMutationSession(root, session);
      return Object.freeze({ files: Object.freeze(records), parents: Object.freeze([...parents.values()]) });
    },
    reserveNativeAttempt: () => {
      requireCheckoutMutationSession(root, session);
      const limits = CHECKOUT_NATIVE_EVIDENCE_LIMITS;
      if (nativeAttempts >= limits.attempts || nativeBudget().retainedBytes + limits.metadataBytes > limits.bytes) throw failure(
        'The original checkout native diagnostic allowance is exhausted before child admission.');
      nativeAttempts++; metadataBytes += limits.metadataBytes;
    },
    remember: error => { if (!unknownOpen) observations.remember(error); },
    open: (file, { io = fs } = {}) => {
      requireCheckoutMutationSession(root, session);
      if (opening || unknownOpen) throw unknown('An original evidence-file open remains unconfirmed.');
      if (owners.length >= LIMIT) throw failure('Checkout evidence exhausted its finite descriptor allowance.');
      const relative = path.relative(session.root, path.resolve(file)).replaceAll('\\', '/');
      if (!admitted.test(relative)) throw failure('Evidence files require an exact original journal or native-stream destination.');
      const directories = []; let parent = session.root;
      for (const part of relative.split('/').slice(0, -1)) {
        parent = path.join(parent, part); const stat = fs.lstatSync(parent, { bigint: true });
        if (stat.isSymbolicLink()) throw failure('Evidence file ancestors must be ordinary directories.');
        assertDirectoryIdentity(stat); directories.push([parent, stat]);
      }
      const captured = ioCaptures.get(captureCheckoutEvidenceIO(io)), open = captured.openSync;
      const methods = { receiver: captured.receiver, stat: captured.fstatSync, read: captured.readSync, close: captured.closeSync,
        write: captured.writeSync, sync: captured.fsyncSync };
      if (relative.includes('/logs/')) methods.write = function (descriptor, data, offset, length, position) {
        if (!Buffer.isBuffer(data) || !Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0
          || offset + length > data.length) throw new TypeError('Native log writes require an exact bounded byte slice.');
        if (nativeBudget().retainedBytes + length > CHECKOUT_NATIVE_EVIDENCE_LIMITS.bytes) throw failure(
          'Native log output exceeds its original checkout aggregate diagnostic allowance.');
        // Reserve before calling the original IO. Only a confirmed short write
        // returns unused allowance; throwing/unknown adapters keep it reserved.
        reservedRawBytes += length;
        const count = captured.writeSync.call(captured.receiver, descriptor, data, offset, length, position);
        if (Number.isSafeInteger(count) && count >= 0 && count <= length) { reservedRawBytes -= length; rawBytes += count; }
        return count;
      };
      let fd, owner;
      opening = true;
      try {
        try { fd = open.call(captured.receiver, file, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW || 0), 0o600); }
        catch (error) {
          // The standard synchronous API does not return an acquired fd when it
          // throws. An overriding adapter cannot provide that same guarantee.
          if (open !== nativeOpen) unknownOpen = true;
          if (unknownOpen) observations.markIncomplete();
          throw error;
        }
        if (!Number.isSafeInteger(fd) || fd < 0) {
          unknownOpen = true; observations.markIncomplete(); throw unknown('Evidence open returned unknown original descriptor evidence.');
        }
        try { owner = createContainedFileResource({ fd, sync: true, methods, additionalMethods: ['write', 'sync'] }); }
        catch (error) { unknownOpen = true; observations.markIncomplete(); throw error; }
        owners.push(owner);
      } finally { opening = false; }
      try {
        const identity = persistenceFileIdentity(owner.operations.stat({ bigint: true }));
        for (const [directory, original] of directories) {
          const actual = fs.lstatSync(directory, { bigint: true });
          if (actual.isSymbolicLink()) throw failure('Evidence file ancestor changed to a link.');
          assertDirectoryIdentity(actual, original);
        }
        assertPersistenceFileIdentity(fs.lstatSync(file, { bigint: true }), identity);
        files.set(relative, { owner, identity, parents: captureEvidenceParents(root, relative) });
      } catch (error) {
        owner.runSync(() => { throw error; });
      }
      return owner;
    }
  });
  groups.set(session, group); return group;
};
