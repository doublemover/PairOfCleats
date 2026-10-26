import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ensureVfsDiskDocument, resolveVfsDiskPath, createVfsColdStartCache } from '../../../src/index/tooling/vfs.js';
import { getContainedFileSession } from '../../../src/shared/contained-file.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const { dir } = await prepareIsolatedTestCacheDir('vfs-mat');
const open = fs.open;
let releaseWrite = () => {}, allowClose = true, retainedSession = null;
const active = [];
try {
  const baseDir = path.join(dir, 'documents'), cacheRoot = path.join(dir, 'cache');
  const virtualPath = '.poc-vfs/src/document.js', text = 'export const answer = 42;\n';
  const docHash = `sha256:${createHash('sha256').update(text).digest('hex')}`;
  const request = { baseDir, virtualPath, text, docHash };
  const cacheOptions = { cacheRoot, indexSignature: 'source-one', manifestHash: 'manifest-one',
    config: { enabled: true, cacheRoot, maxBytes: 65536, maxAgeDays: 1 } };
  const cache = await createVfsColdStartCache(cacheOptions);
  const first = await ensureVfsDiskDocument({ ...request, coldStartCache: cache }); await cache.flush();
  assert.equal(first.cacheHit, false);
  assert.equal(first.materialization.sha256, docHash.slice(7));
  const unchanged = await ensureVfsDiskDocument({ ...request, coldStartCache: cache });
  assert.equal(unchanged.cacheHit, true); assert.equal(unchanged.source, 'memory');
  assert.equal(unchanged.materialization.verificationBytes, 0, 'stable warm identity avoids reading the same bytes again');

  const diskModule = new URL('../../../src/index/tooling/vfs/disk.js', import.meta.url).href;
  let version = 0;
  const coldEnsure = async input => (await import(diskModule + '?cold-fixture=' + version++)).ensureVfsDiskDocument(input);
  const reloaded = await createVfsColdStartCache(cacheOptions);
  const cold = await coldEnsure({ ...request, coldStartCache: reloaded });
  assert.equal(cold.source, 'cold-start'); assert.equal(cold.cacheHit, true);
  assert.equal(cold.materialization.verificationBytes, Buffer.byteLength(text));
  for (const mutation of ['same-size', 'truncated', 'missing']) {
    if (mutation === 'missing') await fs.rm(first.path);
    else await fs.writeFile(first.path, mutation === 'same-size' ? 'x'.repeat(Buffer.byteLength(text)) : 'short');
    const repaired = await coldEnsure({ ...request, coldStartCache: await createVfsColdStartCache(cacheOptions) });
    assert.equal(repaired.cacheHit, false, mutation);
    assert.equal(await fs.readFile(repaired.path, 'utf8'), text, mutation);
    assert.equal(repaired.materialization.sha256, first.materialization.sha256);
  }
  const differentRoot = path.join(dir, 'other-documents');
  const moved = await coldEnsure({ ...request, baseDir: differentRoot, coldStartCache: await createVfsColdStartCache(cacheOptions) });
  assert.equal(moved.path, resolveVfsDiskPath({ baseDir: differentRoot, virtualPath }));
  assert.notEqual(moved.path, first.path); assert.equal(moved.cacheHit, false);
  assert.equal(await fs.readFile(moved.path, 'utf8'), text);

  const concurrent = { ...request, virtualPath: '.poc-vfs/concurrent/document.js' };
  let enteredWrite;
  const entered = new Promise(resolve => { enteredWrite = resolve; });
  const held = new Promise(resolve => { releaseWrite = resolve; });
  let writes = 0, intercept = true;
  fs.open = async (target, flags, ...args) => {
    const handle = await open.call(fs, target, flags, ...args);
    if (intercept && flags === 'wx' && String(target).replaceAll('\\', '/').includes('/concurrent/')) {
      intercept = false; const write = handle.writeFile.bind(handle);
      handle.writeFile = async (...values) => { writes++; enteredWrite(); await held; return write(...values); };
    }
    return handle;
  };
  const initial = ensureVfsDiskDocument(concurrent); initial.catch(() => {});
  active.push(initial);
  await entered;
  const joined = ensureVfsDiskDocument(concurrent); joined.catch(() => {});
  active.push(joined);
  let conflict;
  await assert.rejects(ensureVfsDiskDocument({ ...concurrent, text: 'different content', docHash: 'other-hash' }), error => {
    conflict = error; assert.equal(error.code, 'ERR_VFS_MATERIALIZATION_CONFLICT');
    assert.equal(error.cacheOwnershipPending, true); assert.equal(error.cacheOwnershipReleased(), false); return true;
  });
  releaseWrite(); const [one, two] = await Promise.all([initial, joined]); fs.open = open;
  assert.equal(writes, 1); assert.equal(one, two); assert.equal(conflict.cacheOwnershipReleased(), true);
  assert.equal(await fs.readFile(one.path, 'utf8'), text, 'conflicting requests cannot overwrite the admitted owner');

  const failureRequest = { ...request, virtualPath: '.poc-vfs/publication/document.js' };
  const original = await ensureVfsDiskDocument(failureRequest);
  fs.open = async (target, flags, ...args) => {
    if (flags === 'wx' && String(target).replaceAll('\\', '/').includes('/publication/')) throw Object.assign(new Error('fixture publication denied'), { code: 'EACCES' });
    return open.call(fs, target, flags, ...args);
  };
  await assert.rejects(ensureVfsDiskDocument({ ...failureRequest, text: 'new requested content', docHash: 'new-content' }),
    error => error.code === 'ERR_ATOMIC_WRITE' && error.causeCode === 'EACCES');
  fs.open = open; assert.equal(await fs.readFile(original.path, 'utf8'), text);

  // A failed original close cannot be released by the JavaScript job's finally.
  const pendingRequest = { ...request, virtualPath: '.poc-vfs/pending-close/document.js' };
  let interceptedClose = false;
  fs.open = async (target, flags, ...args) => {
    const handle = await open.call(fs, target, flags, ...args);
    if (!interceptedClose && flags === 'wx' && String(target).replaceAll('\\', '/').includes('/pending-close/')) {
      interceptedClose = true; const close = handle.close.bind(handle);
      handle.close = async () => { if (!allowClose) throw new Error('fixture close still pending'); return close(); };
    }
    return handle;
  };
  allowClose = false;
  await assert.rejects(ensureVfsDiskDocument(pendingRequest), error => {
    assert.equal(error.cacheOwnershipPending, true); assert.equal(error.cacheOwnershipReleased(), false);
    retainedSession = error.containedFileSession || getContainedFileSession(error); assert.ok(retainedSession); return true;
  });
  await assert.rejects(ensureVfsDiskDocument(pendingRequest), error => error.cacheOwnershipPending === true && error.cacheOwnershipReleased() === false);
  allowClose = true; await retainedSession.releaseAfterClose(); retainedSession = null; fs.open = open;
  const recovered = await ensureVfsDiskDocument(pendingRequest);
  assert.equal(await fs.readFile(recovered.path, 'utf8'), text);
} finally {
  releaseWrite(); allowClose = true; fs.open = open;
  try { await Promise.allSettled(active); await retainedSession?.releaseAfterClose(); }
  finally { await fs.rm(dir, { recursive: true, force: true }); }
}
console.log('VFS hits qualify current root/content, preserve unchanged reuse and retain conflicting or failed publication owners.');
