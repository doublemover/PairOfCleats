import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { createSemanticSourceSnapshot } from '../../../src/index/semantic/source.js';
import { retainSemanticSource } from '../../../src/index/semantic/source-storage.js';
import { retainSemanticBytes } from '../../../src/index/semantic/disk-writes.js';
import { createSemanticDiskAccount } from '../../../src/index/build/artifacts/writers/semantic/partition.js';
import { getContainedFileSession } from '../../../src/shared/contained-file.js';

applyTestEnv();
const root = resolveTestCachePath(process.cwd(), 'semantic-source-retention-native-lifetime');
const bytes = Buffer.from('export const value = 1;');
const snapshot = createSemanticSourceSnapshot({ bytes, repositoryNamespace: 'fixture:retention-lifetime', path: 'source.js', language: 'javascript' });
const source = snapshot.manifest, filename = path.join(root, 'semantic-sources', source.byteHash + '.utf8');
await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename, bytes);
const original = { open: fs.open, link: fs.link, rm: fs.rm }, retained = new Map();
const includesFailure = (error, expected) => error === expected || error?.cause && includesFailure(error.cause, expected)
  || Array.isArray(error?.errors) && error.errors.some(value => includesFailure(value, expected));
try {
  const missing = Object.freeze(Object.assign(new Error('original descriptor read missing'), { code: 'ENOENT' }));
  let rejectRead = true, denyClose = true, reads = 0, closes = 0, publications = 0;
  fs.link = async () => { publications++; throw new Error('This lifetime fixture must never publish a physical link.'); };
  fs.open = async (target, ...args) => {
    const handle = await original.open(target, ...args);
    if (path.resolve(String(target)) !== filename) return handle;
    const read = handle.read, close = handle.close; retained.set(handle, () => close.call(handle));
    handle.read = function(...input) { reads++; if (rejectRead) return Promise.reject(missing); return read.call(handle, ...input); };
    handle.close = async function() { closes++; if (denyClose) throw Object.freeze(new Error('original source close failed')); await close.call(handle); retained.delete(handle); };
    return handle;
  };
  const account = createSemanticDiskAccount(1024 * 1024), metrics = {};
  let failure;
  try { await retainSemanticSource({ root, source, sourceCapability: snapshot.sourceCapability, diskAccount: account, metrics }); assert.fail('original close failure must remain owned'); }
  catch (error) { failure = error; }
  assert.equal(failure.code, 'ENOENT'); assert.ok(includesFailure(failure, missing));
  assert.equal(failure.cacheOwnershipReleased(), false); assert.equal(closes, 1); assert.equal(reads, 1);
  assert.equal(publications, 0, 'an unsettled ENOENT cannot fall through to immutable publication');
  assert.equal(metrics.semanticRetentionVerifications, undefined);
  await assert.rejects(retainSemanticSource({ root, source, sourceCapability: snapshot.sourceCapability, diskAccount: account, metrics }), error => error.code === 'ENOENT' && error.cacheOwnershipReleased() === false);
  assert.equal(reads, 1); assert.equal(closes, 1, 'the serialized writer cannot start fresh source IO while its prior original owner remains pending');
  denyClose = false; await getContainedFileSession(failure).releaseAfterClose();
  assert.equal(failure.cacheOwnershipReleased(), true); assert.equal(closes, 2); assert.equal(reads, 1);
  rejectRead = false;
  await retainSemanticSource({ root, source, sourceCapability: snapshot.sourceCapability, diskAccount: account, metrics });
  assert.equal(reads, 2, 'failed-close recovery cannot install a successful source receipt or replay its read');
  assert.equal(metrics.semanticRetentionVerifications, 1); assert.equal(publications, 0);

  fs.open = original.open;
  const temporaryTarget = path.join(root, 'new-source.utf8'), writeFailure = Object.freeze(Object.assign(new Error('original temporary write failed'), { code: 'EIO' }));
  const temporaryAccount = createSemanticDiskAccount(1024 * 1024);
  let temporary, writes = 0, syncs = 0, removals = 0;
  denyClose = true;
  fs.rm = async (...args) => { removals++; return original.rm(...args); };
  fs.open = async (target, ...args) => {
    const handle = await original.open(target, ...args);
    if (!path.basename(String(target)).startsWith('.pending-')) return handle;
    temporary = String(target); const close = handle.close; retained.set(handle, () => close.call(handle));
    handle.writeFile = async () => { writes++; throw writeFailure; };
    handle.sync = async () => { syncs++; };
    handle.close = async () => { if (denyClose) throw Object.freeze(new Error('original temporary close failed')); await close.call(handle); retained.delete(handle); };
    return handle;
  };
  try { await retainSemanticBytes({ root, filename: temporaryTarget, bytes, diskAccount: temporaryAccount }); assert.fail('temporary close failure must remain owned'); }
  catch (error) { failure = error; }
  assert.equal(failure.code, 'EIO'); assert.ok(includesFailure(failure, writeFailure));
  assert.equal(failure.cacheOwnershipReleased(), false); assert.equal(writes, 1); assert.equal(syncs, 0);
  assert.equal(removals, 0); assert.equal(temporaryAccount.used, bytes.length, 'uncertain native ownership retains the admitted disk credit');
  assert.equal((await fs.stat(temporary)).size, 0); assert.equal(publications, 0);
  denyClose = false; await getContainedFileSession(failure).releaseAfterClose();
  assert.equal(failure.cacheOwnershipReleased(), true); assert.equal(writes, 1); assert.equal(removals, 0);
  await original.rm(temporary);
} finally {
  fs.open = original.open; fs.link = original.link; fs.rm = original.rm;
  for (const close of retained.values()) await close();
}
console.log('Source verification and temporary retention settle only their actual original native owners.');
