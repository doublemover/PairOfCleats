import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setImmediate } from 'node:timers/promises';
import { publishIndexStateMutation, withIndexStatePublicationLock } from '../../src/shared/index-state-publication.js';
import { updateSqliteState } from '../../src/storage/sqlite/build/index-state.js';
import { updateLmdbState } from '../../src/storage/lmdb/index-state.js';
import { checksumFile } from '../../src/shared/hash.js';
import { ARTIFACT_SURFACE_VERSION } from '../../src/contracts/versioning.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { errorGraphIncludes, errorGraphSome } from '../helpers/error-graph.js';

// UNVALIDATED: actual native state producers, manifest checksums and original
// file-lock protocol. No native database/model or physical link is required.
applyTestEnv();
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['parallel-namespaces', 'queued-namespace', 'patch-snapshot', 'invalid-namespace', 'invalid-state',
  'malformed-state', 'manifest-failure', 'manifest-recovery', 'pending-mutation', 'abort-before-write',
  'abort-during-write', 'cross-process'].includes(selected));
const parent = path.resolve('.tmp/tasks'); await fs.mkdir(parent, { recursive: true });
const root = await fs.mkdtemp(path.join(parent, 'index-state-publication-'));
const statePath = path.join(root, 'index_state.json'), manifestPath = path.join(root, 'pieces', 'manifest.json');
const lockPath = path.join(root, '.index_state.write.lock');
const initial = { mode: 'code', generatedAt: '2026-10-28T00:00:00.000Z', sqlite: { keepSqlite: true }, lmdb: { keepLmdb: true }, extensions: { caller: { keep: true } } };
const originalOpen = fsSync.openSync;
let injectManifest = false, abortWrite = null, mutationReady = false;
const fault = Object.freeze(Object.assign(new Error('original manifest publication failure'), { code: 'EIO' }));
const pending = Object.freeze(Object.assign(new Error('original mutation work remains outstanding'), {
  cacheOwnershipPending: true, cacheOwnershipReleased() { assert.equal(this, pending); return mutationReady; }
}));
const children = [];
fsSync.openSync = (file, flags, ...args) => {
  if (typeof file === 'string' && typeof flags === 'string' && /[wax]/u.test(flags)) {
    if (injectManifest && path.dirname(file) === path.dirname(manifestPath)) throw fault;
    if (abortWrite && path.dirname(file) === root && path.resolve(file) !== lockPath) { abortWrite.abort(); abortWrite = null; }
  }
  return originalOpen(file, flags, ...args);
};
const read = async () => JSON.parse(await fs.readFile(statePath, 'utf8'));
const checkPair = async () => {
  const state = await read(), manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const checksum = await checksumFile(statePath);
  assert.equal(manifest.pieces[0].bytes, (await fs.stat(statePath)).size);
  assert.equal(manifest.pieces[0].checksum, `${checksum.algo}:${checksum.value}`);
  assert.deepEqual(manifest.pieces[1], { name: 'other', path: 'other.json', bytes: 2, checksum: 'unrelated' });
  assert.deepEqual(state.extensions.caller, initial.extensions.caller);
  await assert.rejects(fs.stat(lockPath), { code: 'ENOENT' });
  return state;
};
const startChild = kind => {
  const child = fork(fileURLToPath(new URL('../fixtures/storage/index-state-writer.js', import.meta.url)), [root, kind], {
    execPath: process.execPath, env: process.env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc']
  });
  const record = { child, messages: [], stderr: '' }; children.push(record);
  child.on('message', value => record.messages.push(value));
  child.stderr.on('data', value => { record.stderr = (record.stderr + value.toString()).slice(-4096); });
  return record;
};
const waitMessage = async (record, expected) => {
  for (let turns = 0; turns < 2; turns++) {
    const existing = record.messages.shift();
    if (existing !== undefined) { assert.equal(existing, expected, record.stderr); return; }
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error(`Child did not send ${expected}: ${record.stderr}`)); }, 5000);
      const cleanup = () => { clearTimeout(timer); record.child.off('message', message); record.child.off('exit', exit); };
      const message = () => { cleanup(); resolve(); };
      const exit = () => { cleanup(); reject(new Error(`Child exited before ${expected}: ${record.stderr}`)); };
      record.child.once('message', message); record.child.once('exit', exit);
    });
  }
  assert.fail(`Missing child message ${expected}`);
};
const waitExit = record => new Promise((resolve, reject) => {
  if (record.child.exitCode !== null || record.child.signalCode !== null) {
    if (record.child.exitCode === 0) resolve(); else reject(new Error(record.stderr));
    return;
  }
  const timer = setTimeout(() => { record.child.off('exit', exited); reject(new Error('Child exit deadline exceeded')); }, 5000);
  const exited = (code, signal) => { clearTimeout(timer); if (code === 0 && !signal) resolve(); else reject(new Error(record.stderr)); };
  record.child.once('exit', exited);
});
try {
  await fs.mkdir(path.dirname(manifestPath)); await fs.writeFile(statePath, JSON.stringify(initial));
  const checksum = await checksumFile(statePath);
  await fs.writeFile(manifestPath, JSON.stringify({ version: 2, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    pieces: [{ name: 'index_state', path: 'index_state.json', bytes: (await fs.stat(statePath)).size, checksum: `${checksum.algo}:${checksum.value}` },
      { name: 'other', path: 'other.json', bytes: 2, checksum: 'unrelated' }] }));
  const before = await fs.readFile(statePath, 'utf8'), manifestBefore = await fs.readFile(manifestPath, 'utf8');
  if (selected === 'parallel-namespaces') {
    await Promise.all(Array.from({ length: 6 }, (_, index) => [
      updateSqliteState(root, { [`sqlite${index}`]: index }), updateLmdbState(root, { [`lmdb${index}`]: index })
    ]).flat());
    const state = await checkPair();
    for (let index = 0; index < 6; index++) { assert.equal(state.sqlite[`sqlite${index}`], index); assert.equal(state.lmdb[`lmdb${index}`], index); }
    assert.equal(state.sqlite.keepSqlite, true); assert.equal(state.lmdb.keepLmdb, true);
  } else if (selected === 'queued-namespace' || selected === 'patch-snapshot') {
    let entered, resume;
    const ready = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { resume = resolve; });
    const held = publishIndexStateMutation(root, async state => { state.extensions.serial = true; entered(); await gate; });
    await ready;
    const patch = { profile: { value: 1 } };
    const queued = selected === 'patch-snapshot' ? updateSqliteState(root, patch) : updateLmdbState(root, { queued: true });
    patch.profile.value = 2;
    await setImmediate(); assert.equal(await fs.readFile(statePath, 'utf8'), before);
    resume(); await Promise.all([held, queued]);
    const state = await checkPair(); assert.equal(state.extensions.serial, true);
    if (selected === 'patch-snapshot') assert.equal(state.sqlite.profile.value, 1); else assert.equal(state.lmdb.queued, true);
    if (selected === 'queued-namespace') {
      let enter, release;
      const started = new Promise(resolve => { enter = resolve; });
      const barrier = new Promise(resolve => { release = resolve; });
      const owner = withIndexStatePublicationLock(root, async () => { enter(); await barrier; });
      await started;
      const controller = new AbortController();
      let canceledEntered = false, successorEntered = false;
      const canceled = withIndexStatePublicationLock(root, () => { canceledEntered = true; }, { signal: controller.signal });
      const rejection = assert.rejects(canceled, { name: 'AbortError' });
      const successor = withIndexStatePublicationLock(root, () => { successorEntered = true; });
      controller.abort(); await rejection;
      const other = path.join(root, 'independent'); await fs.mkdir(other);
      await withIndexStatePublicationLock(other, () => true);
      assert.equal(canceledEntered, false); assert.equal(successorEntered, false);
      assert.equal((await fs.stat(lockPath)).isFile(), true, 'canceling a queued writer retains its predecessor owner');
      release(); await Promise.all([owner, successor]);
      assert.equal(successorEntered, true); assert.equal(canceledEntered, false);
      await assert.rejects(fs.stat(lockPath), { code: 'ENOENT' });
    }
  } else if (selected === 'invalid-state' || selected === 'malformed-state' || selected === 'invalid-namespace') {
    await fs.writeFile(statePath, selected === 'malformed-state' ? '{broken' : selected === 'invalid-state' ? 'null'
      : JSON.stringify({ ...initial, sqlite: [] }));
    const invalidBefore = await fs.readFile(statePath, 'utf8');
    await assert.rejects(updateSqliteState(root, { ready: true }));
    assert.equal(await fs.readFile(statePath, 'utf8'), invalidBefore);
    assert.equal(await fs.readFile(manifestPath, 'utf8'), manifestBefore);
    await assert.rejects(fs.stat(lockPath), { code: 'ENOENT' });
  } else if (selected === 'manifest-failure' || selected === 'manifest-recovery') {
    injectManifest = true;
    await assert.rejects(updateLmdbState(root, { actual: true }), error => errorGraphIncludes(error, fault));
    assert.equal((await read()).lmdb.actual, true, 'failed pair publication preserves the actual already-written state');
    assert.equal(await fs.readFile(manifestPath, 'utf8'), manifestBefore);
    injectManifest = false;
    if (selected === 'manifest-recovery') { await updateSqliteState(root, { repair: true }); const state = await checkPair(); assert.equal(state.lmdb.actual, true); assert.equal(state.sqlite.repair, true); }
  } else if (selected === 'pending-mutation') {
    let failure, calls = 0;
    await assert.rejects(publishIndexStateMutation(root, () => { calls++; return pending; }), error => { failure = error; return true; });
    assert.ok(errorGraphIncludes(failure, pending)); assert.equal(failure.cacheOwnershipReleased(), false);
    assert.equal(await fs.readFile(statePath, 'utf8'), before);
    let session; errorGraphSome(failure, error => { session = error?.fileLockPublicationSession; return Boolean(session); });
    assert.ok(session); mutationReady = true; await session.releaseAfterClose();
    assert.equal(calls, 1); assert.equal(failure.cacheOwnershipReleased(), true);
  } else if (selected === 'abort-before-write' || selected === 'abort-during-write') {
    const controller = new AbortController();
    if (selected === 'abort-during-write') abortWrite = controller;
    await assert.rejects(publishIndexStateMutation(root, state => {
      state.sqlite.changed = true; if (selected === 'abort-before-write') controller.abort();
    }, { signal: controller.signal }), { name: 'AbortError' });
    if (selected === 'abort-before-write') {
      assert.equal(await fs.readFile(statePath, 'utf8'), before); assert.equal(await fs.readFile(manifestPath, 'utf8'), manifestBefore);
    } else { assert.equal((await checkPair()).sqlite.changed, true); }
  } else {
    const holder = startChild('holder'); await waitMessage(holder, 'holding');
    const writer = startChild('lmdb'); await waitMessage(writer, 'contended');
    holder.child.send('commit');
    await Promise.all([waitMessage(holder, 'done'), waitMessage(writer, 'done')]);
    await Promise.all(children.map(waitExit));
    const state = await checkPair(); assert.equal(state.sqlite.fromChild, true); assert.equal(state.lmdb.fromChild, true);
  }
} finally {
  injectManifest = false; abortWrite = null; mutationReady = true; fsSync.openSync = originalOpen;
  for (const record of children) if (record.child.exitCode === null && record.child.signalCode === null) record.child.kill();
  await Promise.allSettled(children.map(waitExit));
  await fs.rm(root, { recursive: true, force: true });
}
console.log(`Serialized index-state publication ${selected} passed`);
