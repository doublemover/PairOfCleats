import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { applyStatePatch, buildRootExists } from '../../../src/index/build/build-state/store.js';
import { createBuildStateWriteFailureError } from '../../../src/index/build/build-state/store-errors.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { isFileLockPublicationSession } from '../../../src/shared/locks/file-lock.js';

// UNVALIDATED: real state/atomic/coordinator owners, inert native-boundary faults.
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['ordinary', 'missing-root', 'root-denied', 'retired-before-lock', 'preparation', 'siblings', 'diagnostic'].includes(selected));
const parent = path.resolve('.tmp/tasks'); await fs.mkdir(parent, { recursive: true });
const root = await fs.mkdtemp(path.join(parent, 'state-owner-'));
const originals = { open: fs.open, stat: fs.stat, access: fs.access, mkdir: fs.mkdir };
const disposers = new Map(), observed = [];
let ready = false;
const rejected = async work => { try { await work(); } catch (error) { observed.push(error); return error; } assert.fail('expected original failure'); };
const tree = (value, found = new Set()) => {
  if (!value || !['object', 'function'].includes(typeof value) || found.has(value)) return found;
  found.add(value);
  for (const field of ['cause', 'workerError', 'storageFailureObservation']) tree(Object.getOwnPropertyDescriptor(value, field)?.value, found);
  const errors = Object.getOwnPropertyDescriptor(value, 'errors')?.value;
  if (Array.isArray(errors)) for (const error of errors) tree(error, found);
  return found;
};
const patch = { phase: 'state-owner', progress: { code: { completed: 1 } } };
const write = () => applyStatePatch(root, patch, [], { durabilityClass: 'required' });
try {
  if (selected === 'missing-root') {
    await fs.rm(root, { recursive: true });
    const error = await rejected(write);
    assert.equal(error.code, 'ERR_BUILD_STATE_WRITE_FAILED'); assert.equal(error.target, 'state-root');
    assert.equal(error.causeCode, 'ERR_BUILD_STATE_ROOT_MISSING'); assert.equal(await buildRootExists(root), false);
  } else if (selected === 'root-denied') {
    const primary = Object.freeze(Object.assign(new Error('root access denied'), { code: 'EACCES' }));
    fs.access = async file => { if (file === root) throw primary; return originals.access(file); };
    assert.equal(await rejected(write), primary, 'denial cannot become a missing-root success');
  } else if (selected === 'retired-before-lock') {
    let retired = false, recreated = 0;
    fs.open = async (file, ...args) => {
      if (!retired && file === path.join(root, 'build_state.write.lock')) {
        retired = true; await fs.rm(root, { recursive: true });
      }
      return originals.open(file, ...args);
    };
    fs.mkdir = async (file, ...args) => { if (file === root) recreated++; return originals.mkdir(file, ...args); };
    const error = await rejected(write);
    assert.equal(error.code, 'ERR_BUILD_STATE_WRITE_FAILED'); assert.equal(error.phase, 'acquire');
    assert.equal(recreated, 0); assert.equal(await buildRootExists(root), false);
  } else if (selected === 'diagnostic') {
    const secondary = Object.freeze(Object.assign(new Error('diagnostic owns native work'), {
      cacheOwnershipReleased() { assert.equal(this, secondary); return ready; }
    }));
    const primary = Object.freeze(Object.defineProperty(new Error('original failure'), 'code', { get() { throw secondary; } }));
    const error = createBuildStateWriteFailureError({ buildRoot: root, target: 'state', phase: 'write', cause: primary });
    assert.equal(error.cause, primary); assert.equal(error.cacheOwnershipReleased(), false);
    ready = true; assert.equal(error.cacheOwnershipReleased(), true);
  } else {
    await fs.writeFile(path.join(root, 'build_state.json'), JSON.stringify({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
      schemaVersion: 1, signatureVersion: 1, buildId: path.basename(root), repo: { root }, repoRoot: root }));
    let stateStats = 0, progressWrites = 0;
    const primary = Object.freeze(Object.assign(new Error('first native fault'), { code: 'EIO' }));
    const secondary = Object.freeze(Object.assign(new Error('independent sidecar native fault'), {
      cacheOwnershipPending: true, cacheOwnershipReleased() { assert.equal(this, secondary); return ready; }
    }));
    fs.stat = async (file, ...args) => {
      if (selected === 'preparation' && file === path.join(root, 'build_state.json') && ++stateStats === 2) throw primary;
      return originals.stat(file, ...args);
    };
    fs.open = async (file, ...args) => {
      const actual = await originals.open(file, ...args);
      if (selected === 'ordinary' || !String(file).includes('.tmp') || path.dirname(file) !== root) return actual;
      const isProgress = String(file).includes('build_state.progress');
      const isState = String(file).includes('build_state.json');
      if (!isProgress && !isState) return actual;
      const close = actual.close.bind(actual); disposers.set(actual, close);
      const owned = { get fd() { return actual.fd; }, read: actual.read.bind(actual), stat: actual.stat.bind(actual),
        write: actual.write.bind(actual), sync: actual.sync.bind(actual),
        writeFile(...values) {
          assert.equal(this, owned); if (isProgress) progressWrites++;
          if (selected === 'siblings') throw isProgress ? primary : secondary;
          return actual.writeFile(...values);
        }, async close() { assert.equal(this, owned); await close(); disposers.delete(actual); } };
      return owned;
    };
    if (selected === 'ordinary') {
      const value = await write(); assert.equal(value.phase, patch.phase);
      assert.equal(JSON.parse(await fs.readFile(path.join(root, 'build_state.progress.json'), 'utf8')).code.completed, 1);
      await assert.rejects(fs.stat(path.join(root, 'build_state.write.lock')), { code: 'ENOENT' });
    } else {
      const error = await rejected(write), errors = tree(error);
      assert.equal(errors.has(primary), true);
      if (selected === 'preparation') {
        assert.equal(progressWrites, 0, 'no sidecar write starts before all preparation succeeds');
        await assert.rejects(fs.stat(path.join(root, 'build_state.write.lock')), { code: 'ENOENT' });
      } else {
        assert.equal(errors.has(secondary), true, 'all independently rejected siblings survive');
        assert.equal(error.cacheOwnershipReleased(), false);
        assert.equal((await fs.stat(path.join(root, 'build_state.write.lock'))).isFile(), true,
          'original coordinator remains published until the actual native owners settle');
        const files = [...new Set([...errors].map(getContainedFileSession).filter(Boolean))];
        const locks = [...new Set([...errors].map(value => Object.getOwnPropertyDescriptor(value, 'fileLockPublicationSession')?.value)
          .filter(isFileLockPublicationSession))];
        assert.ok(files.length); assert.equal(locks.length, 1);
        ready = true;
        for (const session of files) await session.releaseAfterClose();
        for (const session of locks) await session.releaseAfterClose();
        assert.equal(error.cacheOwnershipReleased(), true);
        await assert.rejects(fs.stat(path.join(root, 'build_state.write.lock')), { code: 'ENOENT' });
      }
    }
  }
} finally {
  ready = true; Object.assign(fs, originals);
  for (const error of observed) {
    const errors = tree(error);
    for (const session of new Set([...errors].map(getContainedFileSession).filter(Boolean))) await session.releaseAfterClose();
    for (const session of new Set([...errors].map(value => Object.getOwnPropertyDescriptor(value, 'fileLockPublicationSession')?.value)
      .filter(isFileLockPublicationSession))) await session.releaseAfterClose();
  }
  for (const close of disposers.values()) await close();
  await fs.rm(root, { recursive: true, force: true });
}
console.log(`Build-state original resource ownership: ${selected}`);
