import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fork } from 'node:child_process';
import { createVfsMaterializationSession, ensureVfsDiskDocument } from '../../../src/index/tooling/vfs/disk.js';
import { repoAccessPaths } from '../../../src/shared/cache/repo-access.js';
import { withVfsPublicationAdmission } from '../../../src/index/tooling/vfs/publication-owner.js';
import { applyTestEnv } from '../../helpers/test-env.js';

// UNVALIDATED: real child processes, original VFS/provider pins and tiny files.
// No server executable, physical links, privilege change or benchmark campaign.
applyTestEnv();
const fixtureMode = process.argv[2] === '--vfs-process-fixture';
if (fixtureMode) {
  const doc = JSON.parse(process.argv[3]); let closed = false;
  const scope = createVfsMaterializationSession({ isClosed: () => closed });
  try {
    const result = await ensureVfsDiskDocument({ ...doc, materializationSession: scope });
    process.send({ type: 'ready', ok: true, result });
  } catch (error) { process.send({ type: 'ready', ok: false, code: error.code }); }
  process.on('message', message => {
    if (message?.type !== 'close') return;
    try {
      closed = true; scope.releaseAfterClosure();
      process.send({ type: 'closed', ok: true }, () => process.disconnect());
    } catch (error) { process.send({ type: 'closed', ok: false, code: error.code }, () => process.disconnect()); process.exitCode = 1; }
  });
} else {
  const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
  assert.ok(['conflict', 'same-content', 'different-homes', 'independent-documents', 'without-doc-hash',
    'unknown-owner', 'pending-cache', 'metadata-failure', 'observer-retention', 'reserved-namespace'].includes(selected));
  const parent = path.resolve('.tmp/tasks'); await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, 'vfs-process-'));
  const doc = { baseDir: root, virtualPath: 'src/document.js', text: 'export const value = "original";\n',
    docHash: selected === 'without-doc-hash' ? null : 'content-original' };
  const replacement = { ...doc, text: 'export const value = "replacement";\n', docHash: 'content-replacement' };
  const children = [], scopes = [];
  const launch = async (input, home = path.join(root, 'child-home')) => {
    const child = fork(fileURLToPath(import.meta.url), ['--vfs-process-fixture', JSON.stringify(input)], {
      windowsHide: true, execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env, PAIROFCLEATS_HOME: home }
    });
    let output = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output = (output + chunk).slice(-16384); });
    const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
    const messages = [], waiters = new Map();
    child.on('message', message => { const waiter = waiters.get(message.type); if (waiter) waiter(message); else messages.push(message); });
    const wait = type => new Promise((resolve, reject) => {
      const found = messages.findIndex(message => message.type === type);
      if (found !== -1) { resolve(messages.splice(found, 1)[0]); return; }
      const timer = setTimeout(() => { waiters.delete(type); reject(new Error(`VFS child ${type} deadline: ${output}`)); }, 5000);
      waiters.set(type, value => { clearTimeout(timer); waiters.delete(type); resolve(value); });
    });
    let done = false;
    const owner = { child, exited, wait, async close() {
      if (done) return;
      child.send({ type: 'close' });
      const closed = await wait('closed'); assert.equal(closed.ok, true, output);
      const exit = await Promise.race([exited, new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error(`VFS child exit deadline: ${output}`)), 5000);
        exited.then(() => clearTimeout(timer));
      })]);
      assert.deepEqual(exit, { code: 0, signal: null }, output); done = true;
    } };
    children.push(owner); return { owner, ready: await wait('ready') };
  };
  const makeScope = () => {
    let closed = false;
    const scope = createVfsMaterializationSession({ isClosed: () => closed });
    const owner = { scope, close: () => { closed = true; return scope.releaseAfterClosure(); } }; scopes.push(owner); return owner;
  };
  try {
    if (selected === 'reserved-namespace') {
      for (const virtualPath of ['.poc-vfs-access/writers/file.lock', '.POC-VFS-ACCESS/readers/lease.json', '.poc-vfs-access. /document.js']) {
        await assert.rejects(ensureVfsDiskDocument({ ...doc, virtualPath }), { code: 'ERR_VFS_MATERIALIZATION_PATH' });
      }
    } else if (selected === 'unknown-owner') {
      const first = await ensureVfsDiskDocument(doc);
      const coordinationRoot = path.join(root, '.poc-vfs-access', 'readers'), paths = repoAccessPaths(first.path, { coordinationRoot });
      await fs.mkdir(paths.leases, { recursive: true });
      const unknown = path.join(paths.leases, 'unknown.json'); await fs.writeFile(unknown, '{"pid":-1}');
      await assert.rejects(ensureVfsDiskDocument(replacement), { code: 'ERR_VFS_MATERIALIZATION_CONFLICT' });
      assert.equal(await fs.readFile(first.path, 'utf8'), doc.text); await fs.unlink(unknown);
      await ensureVfsDiskDocument(replacement);
    } else if (selected === 'observer-retention') {
      const first = await ensureVfsDiskDocument(doc);
      let throwing = true, observedSettled = false;
      const pending = Object.freeze(Object.assign(new Error('Independent original observer owner.'), {
        cacheOwnershipPending: true, cacheOwnershipReleased: () => observedSettled
      }));
      const pin = await withVfsPublicationAdmission({ root, target: first.path }, admission => admission.pin(() => {
        if (throwing) throw pending; return true;
      }));
      scopes.push({ close: () => { throwing = false; observedSettled = true; pin.releaseAfterClosure(); } });
      assert.throws(() => pin.releaseAfterClosure()); throwing = false;
      assert.throws(() => pin.releaseAfterClosure(), 'a later true callback cannot erase its original independent pending observer');
      const blocked = await launch(replacement); assert.equal(blocked.ready.code, 'ERR_VFS_MATERIALIZATION_CONFLICT'); await blocked.owner.close();
      observedSettled = true; pin.releaseAfterClosure();
      const next = await launch(replacement); assert.equal(next.ready.ok, true); await next.owner.close();
    } else if (selected === 'pending-cache') {
      let entered, release;
      const started = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
      const publishing = ensureVfsDiskDocument({ ...doc, coldStartCache: { async set() { entered(); await gate; } } });
      try {
        await started;
        const probe = await launch(replacement); assert.equal(probe.ready.ok, false); assert.equal(probe.ready.code, 'ERR_VFS_MATERIALIZATION_CONFLICT');
        await probe.owner.close();
      } finally { release(); await publishing; }
      const probe = await launch(replacement); assert.equal(probe.ready.ok, true); await probe.owner.close();
    } else if (selected === 'metadata-failure') {
      const consumer = makeScope(); const first = await ensureVfsDiskDocument({ ...doc, materializationSession: consumer.scope });
      const remove = fsSync.rmSync; let deny = true;
      fsSync.rmSync = (file, ...args) => {
        if (deny && String(file).includes('.poc-vfs-access') && String(file).includes(`${path.sep}leases${path.sep}`)) throw new Error('Original VFS pin metadata removal denied.');
        return remove(file, ...args);
      };
      try {
        assert.throws(consumer.close);
        const probe = await launch(replacement); assert.equal(probe.ready.code, 'ERR_VFS_MATERIALIZATION_CONFLICT'); await probe.owner.close();
        assert.equal(await fs.readFile(first.path, 'utf8'), doc.text);
        deny = false; consumer.close();
      } finally { deny = false; fsSync.rmSync = remove; }
      const probe = await launch(replacement); assert.equal(probe.ready.ok, true); await probe.owner.close();
    } else {
      const first = await launch(doc); assert.equal(first.ready.ok, true);
      const disk = first.ready.result.path;
      if (selected === 'same-content' || selected === 'without-doc-hash') {
        const before = await fs.stat(disk, { bigint: true }), consumer = makeScope();
        const reused = await ensureVfsDiskDocument({ ...doc, materializationSession: consumer.scope });
        assert.equal(reused.cacheHit, true); assert.equal((await fs.stat(disk, { bigint: true })).ino, before.ino);
        await first.owner.close();
        await assert.rejects(ensureVfsDiskDocument(replacement), { code: 'ERR_VFS_MATERIALIZATION_CONFLICT' });
        consumer.close();
      } else if (selected === 'independent-documents') {
        await ensureVfsDiskDocument({ ...replacement, virtualPath: 'src/independent.js' }); await first.owner.close();
      } else {
        await assert.rejects(ensureVfsDiskDocument(replacement), { code: 'ERR_VFS_MATERIALIZATION_CONFLICT' });
        assert.equal(await fs.readFile(disk, 'utf8'), doc.text);
        if (selected === 'different-homes') {
          const other = await launch(replacement, path.join(root, 'other-home'));
          assert.equal(other.ready.code, 'ERR_VFS_MATERIALIZATION_CONFLICT'); await other.owner.close();
        }
        await first.owner.close();
      }
      const changed = await ensureVfsDiskDocument(replacement); assert.equal(await fs.readFile(changed.path, 'utf8'), replacement.text);
    }
  } finally {
    for (const owner of scopes) owner.close();
    for (const owner of children) await owner.close();
    await fs.rm(root, { recursive: true, force: true });
  }
  console.log(`Cross-process VFS publication: ${selected}`);
}
