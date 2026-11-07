import fs from 'node:fs';
import path from 'node:path';
import { assertNoSymlinkPath } from '../contained-file.js';
import { createContainedFileResource } from '../contained-file-resource.js';
import { addStorageFailureContext } from './operation-error.js';
import { observeStorageResource, describeStorageFailure } from './failure-observation.js';
import { acquireStorageSession } from './session.js';
import { nativePublicationRegistryPaths, nativePublicationHomeDigest } from './native-publication-paths.js';

const exists = target => {
  assertNoSymlinkPath(path.parse(target).root, target, { allowMissing: true });
  try { fs.lstatSync(target); return true; }
  catch (error) {
    if (describeStorageFailure(error, { phase: 'native-coordination-stat' }).code === 'ENOENT') return false;
    throw error;
  }
};
const publishHomeGuard = (paths, home) => {
  assertNoSymlinkPath(paths.root, paths.homeGuard, { allowMissing: true });
  let fd;
  try { fd = fs.openSync(paths.homeGuard, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600); }
  catch (error) {
    if (describeStorageFailure(error, { phase: 'native-home-guard-create' }).code === 'EEXIST') return;
    throw error;
  }
  const owner = createContainedFileResource({ fd, sync: true, methods: { receiver: fs,
    close: fs.closeSync, stat: fs.fstatSync, read: fs.readSync, writeFile: fs.writeFileSync, sync: fs.fsyncSync },
  additionalMethods: ['writeFile', 'sync'] });
  owner.runSync(descriptor => {
    const before = descriptor.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n) throw new Error('Native home guard is not its original ordinary file.');
    descriptor.writeFile(JSON.stringify({ schemaVersion: 1, kind: 'native-publication-home', homeDigest: nativePublicationHomeDigest(home) }) + '\n', 'utf8');
    descriptor.sync();
    assertNoSymlinkPath(paths.root, paths.homeGuard);
    const after = fs.lstatSync(paths.homeGuard, { bigint: true });
    if (after.dev !== before.dev || after.ino !== before.ino || after.nlink !== 1n) throw new Error('Native home guard changed during publication.');
  });
};

/** Reuse the existing lease protocol at a store-local coordinator as well as
 * the launch-home coordinator. No new native reader can be invisible to a
 * registered store's cleanup merely because PAIROFCLEATS_HOME differs. */
export const acquireConfiguredSharedSession = (selection, { home, writable = false }) => {
  const paths = nativePublicationRegistryPaths(selection.target, { home });
  const present = exists(selection.target), registered = exists(paths.record);
  let session = null;
  try {
    const parent = path.dirname(selection.target);
    if (!writable && !exists(parent)) throw Object.assign(new Error('Native target parent does not exist.'), { code: 'ENOENT' });
    assertNoSymlinkPath(path.parse(paths.root).root, paths.root, { allowMissing: true });
    fs.mkdirSync(paths.root, { recursive: true });
    assertNoSymlinkPath(path.parse(paths.root).root, paths.root);
    const roots = selection.backend === 'sqlite' ? [selection.target, `${selection.target}-wal`, `${selection.target}-shm`, `${selection.target}-journal`]
      : [selection.target];
    session = acquireStorageSession({ roots, authorizedRoots: [selection.namespace, paths.root],
      coordinationRoot: paths.access, scope: `configured-${selection.backend}-shared` });
    publishHomeGuard(paths, home);
    return session;
  } catch (error) {
    let failure = error;
    if (session) {
      // Admission precedes native open. A healthy independent metadata owner
      // can retire without claiming that a failed descriptor write settled.
      try { session.releaseAfterSettlement({ resourceId: session.resourceId, settled: true, pending: false }); }
      catch (cleanup) { failure = addStorageFailureContext(error, {}, cleanup, { secondaryPresent: true }); }
    }
    observeStorageResource(failure, { phase: 'native-coordination-admission' }).requireSettled();
    const diagnostic = describeStorageFailure(failure, { phase: 'native-coordination-admission' });
    // Existing unregistered read-only stores cannot be made deletable by this
    // fallback. Registered stores require the shared handshake or fail closed.
    if (!registered && present && ['EACCES', 'EPERM', 'EROFS'].includes(diagnostic.code)) return null;
    throw failure;
  }
};
