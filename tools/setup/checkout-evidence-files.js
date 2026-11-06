import fs from 'node:fs';
import path from 'node:path';
import { createContainedFileResource } from '../../src/shared/contained-file-resource.js';
import { assertDirectoryIdentity } from '../../src/shared/io/directory-sync.js';
import { persistenceFileIdentity, assertPersistenceFileIdentity } from '../../src/shared/io/file-identity.js';
import { createStorageObservationLedger } from '../../src/shared/storage/failure-observation.js';
import { requireCheckoutMutationSession, retainCheckoutMutationPrerequisite } from './checkout-mutation.js';

const groups = new WeakMap();
const LIMIT = 1024; // One journal plus two streams for each of 384 native attempts.
const failure = message => Object.assign(new Error(message), { code: 'ERR_CHECKOUT_EVIDENCE_FILE' });
const admitted = /^(?:\.tmp\/checkout-bootstrap\/j-[a-zA-Z0-9_-]{6,32}\/stages\.jsonl|\.tmp\/checkout-bootstrap\/logs\/n-[a-zA-Z0-9_-]{6,32}\/\d{3}\.(?:stdout|stderr))$/;

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
      const open = io.openSync, methods = { receiver: io, stat: io.fstatSync, read: io.readSync, close: io.closeSync,
        write: io.writeSync, sync: io.fsyncSync };
      let fd, owner;
      opening = true;
      try {
        try { fd = open.call(io, file, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW || 0), 0o600); }
        catch (error) {
          // The standard synchronous API does not return an acquired fd when it
          // throws. An overriding adapter cannot provide that same guarantee.
          if (open !== fs.openSync) unknownOpen = true;
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
