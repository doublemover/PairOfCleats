import fs from 'node:fs';
import path from 'node:path';
import { createContainedFileResource } from '../../src/shared/contained-file-resource.js';
import { assertDirectoryIdentity } from '../../src/shared/io/directory-sync.js';
import { persistenceFileIdentity, assertPersistenceFileIdentity } from '../../src/shared/io/file-identity.js';
import { createStorageObservationLedger } from '../../src/shared/storage/failure-observation.js';
import { requireCheckoutMutationSession, retainCheckoutMutationPrerequisite } from './checkout-mutation.js';

const groups = new WeakMap();
const ioCaptures = new WeakMap(), nativeOpen = fs.openSync;
const LIMIT = 1024; // One journal plus two streams for each of 384 native attempts.
const failure = message => Object.assign(new Error(message), { code: 'ERR_CHECKOUT_EVIDENCE_FILE' });
const admitted = /^(?:\.tmp\/checkout-bootstrap\/j-[a-zA-Z0-9_-]{6,32}\/stages\.jsonl|\.tmp\/checkout-bootstrap\/logs\/n-[a-zA-Z0-9_-]{6,32}\/\d{3}\.(?:stdout|stderr))$/;

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
  requireCheckoutMutationSession(root, session);
  if (groups.has(session)) return groups.get(session);
  const owners = [], ownFailures = new WeakSet(), observations = createStorageObservationLedger({ isOwnFailure: error => ownFailures.has(error) });
  let opening = false, unknownOpen = false;
  const isSettled = () => !opening && !unknownOpen && owners.every(owner => owner.isSettled()) && observations.isSettled();
  const unknown = message => {
    const error = Object.assign(failure(message), { cacheOwnershipPending: true, cacheOwnershipReleased: isSettled });
    ownFailures.add(error); return error;
  };
  retainCheckoutMutationPrerequisite(root, session, isSettled);
  const group = Object.freeze({ isSettled,
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
      } catch (error) {
        owner.runSync(() => { throw error; });
      }
      return owner;
    }
  });
  groups.set(session, group); return group;
};
