import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inspectStorageCategory } from '../../../tools/storage/category-inventory.js';
import { inspectEmbeddingStorageProfile } from '../../../tools/storage/embedding-adapter.js';
import { resolveEmbeddingCacheProfile } from '../../../src/shared/embeddings-cache/layout.js';
import { buildCacheIdentity } from '../../../tools/build/embeddings/cache.js';
import { writePersistentCommandProbeCache } from '../../../src/index/tooling/command-probe-persistent-cache.js';
import { buildToolInstallReceipt, writeToolInstallReceipt } from '../../../tools/tooling/install-receipts.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';

const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'poc-category-adapter-resource-'));
const home = path.join(temporary, 'home');
const open = fsp.open, openSync = fs.openSync, readSync = fs.readSync, closeSync = fs.closeSync, lstatSync = fs.lstatSync;
const disposableHandles = new Set(), disposableFds = new Set();
const samePath = (left, right) => typeof left === 'string' && (process.platform === 'win32'
  ? path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase() : path.resolve(left) === path.resolve(right));
try {
  const tooling = path.join(home, 'tooling');
  assert.equal(writePersistentCommandProbeCache({ providerId: 'fixture', command: process.execPath, args: ['--version'], cwd: temporary,
    probeEnv: {}, toolingConfig: { cache: { dir: tooling } }, attempted: [{ ok: true }] }), true);
  const probeRoot = path.join(tooling, 'command-probes');
  const probeFile = path.join(probeRoot, (await fsp.readdir(probeRoot)).find(name => name.endsWith('.json')));
  {
    let ready = false, selectedFd, failure, closes = 0;
    const original = Object.freeze(Object.assign(new Error('original command-probe read is pending'), {
      cacheOwnershipReleased() { assert.equal(this, original); return ready; }
    }));
    fs.openSync = (file, ...args) => { const fd = openSync(file, ...args); if (samePath(file, probeFile)) { selectedFd = fd; disposableFds.add(fd); } return fd; };
    fs.readSync = (fd, ...args) => { if (fd === selectedFd) throw original; return readSync(fd, ...args); };
    fs.closeSync = fd => { if (fd === selectedFd) closes += 1; const result = closeSync(fd); disposableFds.delete(fd); return result; };
    await assert.rejects(inspectStorageCategory({ category: 'command-probes', root: probeRoot, home }),
      error => { failure = error; return error.cacheOwnershipPending === true; });
    assert.equal(closes, 0);
    assert.equal(failure.cacheOwnershipReleased(), false);
    ready = true; getContainedFileSession(failure).releaseAfterCloseSync();
    assert.equal(closes, 1); assert.equal(failure.cacheOwnershipReleased(), true);
    fs.openSync = openSync; fs.readSync = readSync; fs.closeSync = closeSync;
  }

  const dictionaries = path.join(home, 'dictionaries');
  await fsp.mkdir(dictionaries);
  const dictionaryManifest = path.join(dictionaries, 'dictionaries.json');
  await fsp.writeFile(dictionaryManifest, '{}');
  const consumer = path.join(tooling, 'fixture-consumer');
  await fsp.writeFile(consumer, 'fixture executable identity; not executed');
  const receipt = buildToolInstallReceipt({ tool: { id: 'fixture-tool' }, toolingRoot: tooling,
    result: { path: consumer, probe: { ok: true, identity: { version: '1' } } }, action: { cmd: 'npm', args: [], scope: 'cache' } });
  const receiptPath = writeToolInstallReceipt(tooling, receipt);
  for (const [category, root, target] of [['dictionaries', dictionaries, dictionaryManifest], ['managed-installations', tooling, receiptPath]]) {
    let ready = false, failure, closes = 0;
    const original = Object.freeze(Object.assign(new Error(`original ${category} read remains pending`), {
      cacheOwnershipReleased() { assert.equal(this, original); return ready; }
    }));
    fsp.open = async (file, ...args) => {
      const handle = await open(file, ...args);
      if (!samePath(file, target)) return handle;
      disposableHandles.add(handle);
      return { fd: handle.fd, stat: handle.stat.bind(handle), read: async () => { throw original; },
        close: async () => { closes += 1; const result = await handle.close(); disposableHandles.delete(handle); return result; } };
    };
    await assert.rejects(inspectStorageCategory({ category, root, home, registeredRoots: [home] }),
      error => { failure = error; return error.cacheOwnershipPending === true; });
    assert.equal(closes, 0, 'ordinary incomplete inventory cannot replace the actual reader lifetime');
    assert.equal(failure.cacheOwnershipReleased(), false);
    const session = getContainedFileSession(failure);
    assert.ok(session);
    ready = true; await session.releaseAfterClose();
    assert.equal(closes, 1); assert.equal(failure.cacheOwnershipReleased(), true);
    fsp.open = open;
  }

  const { identity } = buildCacheIdentity({ provider: 'stub', modelId: 'adapter-pending', dims: 2 });
  const profile = resolveEmbeddingCacheProfile({ cacheRoot: temporary, identity });
  const directory = path.join(profile.canonical, 'global-chunks');
  await fsp.mkdir(directory, { recursive: true });
  const target = path.join(directory, 'cache.index.json');
  let ready = false, failure;
  const original = Object.freeze(Object.assign(new Error('pending metadata ENOENT is not absence authority'), { code: 'ENOENT',
    cacheOwnershipReleased() { assert.equal(this, original); return ready; } }));
  fs.lstatSync = (file, ...args) => { if (samePath(file, target)) throw original; return lstatSync(file, ...args); };
  await assert.rejects(inspectEmbeddingStorageProfile({ cacheRoot: temporary, identity }),
    error => { failure = error; return error.cacheOwnershipPending === true; });
  assert.equal(failure.cacheOwnershipReleased(), false);
  ready = true; assert.equal(failure.cacheOwnershipReleased(), true);
  fs.lstatSync = lstatSync;
  const cancelled = new AbortController(); cancelled.abort();
  const stopped = await inspectEmbeddingStorageProfile({ cacheRoot: temporary, identity, signal: cancelled.signal });
  assert.equal(stopped.physical, null);
  assert.equal(stopped.stopReason, 'cancelled');
  assert.equal(stopped.complete, false);
} finally {
  fsp.open = open; fs.openSync = openSync; fs.readSync = readSync; fs.closeSync = closeSync; fs.lstatSync = lstatSync;
  for (const handle of disposableHandles) await handle.close();
  for (const fd of disposableFds) { try { closeSync(fd); } catch {} }
  await fsp.rm(temporary, { recursive: true, force: true });
}
console.log('Storage category consumers preserve original resource observations and cancelled admission.');
