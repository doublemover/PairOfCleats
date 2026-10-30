import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';
import { createContainedFileResource, getContainedFileSession } from '../../../src/shared/contained-file-resource.js';

const { dir } = await prepareIsolatedTestCacheDir('cleanup-removal-failures');
const source = new URL('../../../src/index/build/artifacts-write/family-dispatch.js', import.meta.url).href;
const real = new URL('../../../src/shared/io/remove-path-with-retry.js', import.meta.url).href;
const fixture = 'artifact-cleanup-removal-fixture:original-failure';
const faults = new Map(); globalThis.artifactCleanupRemovalFixture = faults;
const accessFaults = new Map(), originalAccess = fs.access;
fs.access = async (target, ...args) => {
  if (accessFaults.has(target)) throw accessFaults.get(target);
  return originalAccess(target, ...args);
};
const hook = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.startsWith(source) && specifier.endsWith('/remove-path-with-retry.js')) return { url: fixture, shortCircuit: true };
  return next(specifier, context);
}, load(url, context, next) {
  if (url === fixture) return { format: 'module', shortCircuit: true, source: `
    import {removePathWithRetry as actual} from ${JSON.stringify(real)};
    export const removePathWithRetry=async(target,options)=>{
      const fault=globalThis.artifactCleanupRemovalFixture.get(target);
      if(!fault)return actual(target,options);
      fault.calls++;
      if(fault.kind==='throw')throw fault.error;
      return {ok:false,attempts:1,error:fault.error};
    };` };
  return next(url, context);
} });
try {
  const { prepareArtifactCleanup } = await import(source + '?failure-receipts');
  for (const immediate of [true, false]) for (const code of ['EACCES', 'EIO', 'EMFILE']) {
    const outDir = path.join(dir, `observe-${immediate}-${code}`); await fs.mkdir(outDir);
    const target = path.join(outDir, 'failed.json'), good = path.join(outDir, 'good.json');
    await fs.writeFile(target, 'observation failure must retain this target'); await fs.writeFile(good, 'healthy sibling');
    const indexState = {}, removed = [], error = Object.freeze(Object.assign(new Error('original access failed'), { code }));
    const cleanup = await prepareArtifactCleanup({ outDir, indexState, vectorOnlyProfile: false,
      tokenPostingsFormat: 'json', tokenPostingsUseShards: false, removePieceFile: name => removed.push(name) });
    accessFaults.set(target, error);
    await assert.rejects(cleanup.removeArtifact(target, { immediate }), value => errorGraphIncludes(value, error));
    assert.equal(indexState.extensions.artifactCleanup.failedActions, 1);
    assert.equal(indexState.extensions.artifactCleanup.actions[0].phase, 'observation');
    await cleanup.removeArtifact(good, { immediate });
    assert.equal(indexState.extensions.artifactCleanup.status, 'completed-with-warnings', 'later sibling staging cannot erase observation failure');
    const receipt = await cleanup.commitArtifactCleanup({ concurrency: 1 });
    assert.equal(receipt.plannedActions, 2); assert.equal(receipt.failedActions, 1); assert.equal(receipt.completedActions, 1);
    assert.ok(errorGraphIncludes(receipt.failure, error)); assert.deepEqual(removed, [good]);
    assert.equal(await fs.readFile(target, 'utf8'), 'observation failure must retain this target');
    assert.equal((await cleanup.commitArtifactCleanup()).failedActions, 1);
    accessFaults.delete(target);
  }
  {
    const outDir = path.join(dir, 'prepare-observe-failure'); await fs.mkdir(outDir);
    const target = path.join(outDir, 'token_postings.packed.bin'), indexState = {};
    await fs.writeFile(target, 'existing sparse target');
    const error = Object.assign(new Error('initial selection observation failed'), { code: 'EACCES' });
    accessFaults.set(target, error);
    await assert.rejects(prepareArtifactCleanup({ outDir, indexState, vectorOnlyProfile: false,
      tokenPostingsFormat: 'json', tokenPostingsUseShards: false }), value => errorGraphIncludes(value, error));
    assert.equal(indexState.extensions.artifactCleanup.failedActions, 1);
    assert.equal(indexState.extensions.artifactCleanup.failures[0].path, path.basename(target));
    accessFaults.delete(target);
  }
  {
    const outDir = path.join(dir, 'pending-absence-observation'); await fs.mkdir(outDir);
    const target = path.join(outDir, 'retained.json'); await fs.writeFile(target, 'original live descriptor');
    const handle = await fs.open(target, 'r'), close = handle.close.bind(handle);
    let allowed = false, pending;
    handle.close = async () => { if (!allowed) throw new Error('original observation descriptor close unconfirmed'); return close(); };
    const owner = createContainedFileResource({ handle, sync: false });
    try { await owner.run(() => { throw Object.assign(new Error('absence diagnostic has an original pending reader'), { code: 'ENOENT' }); }); }
    catch (error) { pending = error; }
    const indexState = {}, cleanup = await prepareArtifactCleanup({ outDir, indexState, vectorOnlyProfile: false,
      tokenPostingsFormat: 'json', tokenPostingsUseShards: false });
    try {
      accessFaults.set(target, pending);
      await assert.rejects(cleanup.removeArtifact(target), error => errorGraphIncludes(error, pending));
      assert.equal(indexState.extensions.artifactCleanup.failedActions, 1);
      assert.equal(indexState.extensions.artifactCleanup.failure.cacheOwnershipReleased(), false);
      assert.equal(await fs.readFile(target, 'utf8'), 'original live descriptor');
    } finally {
      accessFaults.delete(target); allowed = true; await getContainedFileSession(pending).releaseAfterClose();
    }
    assert.equal(indexState.extensions.artifactCleanup.failure.cacheOwnershipReleased(), true);
  }
  {
    const outDir = path.join(dir, 'known-absence'); await fs.mkdir(outDir);
    const cleanup = await prepareArtifactCleanup({ outDir, vectorOnlyProfile: false,
      tokenPostingsFormat: 'json', tokenPostingsUseShards: false });
    assert.equal((await cleanup.commitArtifactCleanup()).status, 'not-required');
    assert.deepEqual(await cleanup.removeArtifact(path.join(outDir, 'missing.json')), {
      ok: true, staged: false, targetPath: path.join(outDir, 'missing.json') });
  }
  for (const immediate of [true, false]) for (const kind of ['result', 'throw', 'pending']) {
    const outDir = path.join(dir, `${immediate}-${kind}`); await fs.mkdir(outDir);
    const target = path.join(outDir, 'failed.json'), good = path.join(outDir, 'good.json');
    await fs.writeFile(target, 'original failed target'); await fs.writeFile(good, 'removable target');
    let settled = false;
    const error = Object.assign(new Error('original removal boundary failed'), { code: 'EIO',
      ...(kind === 'pending' ? { cacheOwnershipPending: true, cacheOwnershipReleased: () => settled } : {}) });
    const fault = { kind: kind === 'pending' ? 'result' : kind, error, calls: 0 }; faults.set(target, fault);
    const indexState = {}, removed = [];
    const cleanup = await prepareArtifactCleanup({ outDir, indexState, profileId: 'default',
      vectorOnlyProfile: false, tokenPostingsFormat: 'json', tokenPostingsUseShards: false,
      removePieceFile: name => removed.push(name) });
    if (immediate) {
      await assert.rejects(cleanup.removeArtifact(target, { immediate: true }), value => errorGraphIncludes(value, error));
      assert.equal(indexState.extensions.artifactCleanup.failedActions, 1);
      await cleanup.removeArtifact(good, { immediate: true });
    } else {
      await cleanup.removeArtifact(target); await cleanup.removeArtifact(good);
    }
    const receipt = await cleanup.commitArtifactCleanup({ concurrency: 1 });
    assert.equal(receipt.plannedActions, 2); assert.equal(receipt.completedActions, 1); assert.equal(receipt.failedActions, 1);
    assert.equal(receipt.status, 'completed-with-warnings'); assert.equal(fault.calls, 1);
    assert.equal(await fs.readFile(target, 'utf8'), 'original failed target');
    await assert.rejects(fs.stat(good), { code: 'ENOENT' }); assert.deepEqual(removed, [good]);
    assert.ok(errorGraphIncludes(receipt.failure, error));
    assert.equal(indexState.extensions.artifactCleanup.failure, receipt.failure);
    assert.equal(indexState.extensions.artifactCleanup.completedActions, receipt.completedActions);
    assert.equal(indexState.extensions.artifactCleanup.failedActions, receipt.failedActions);
    assert.equal(Object.keys(receipt).includes('failure'), false, 'runtime ownership is not serialized as diagnostic JSON');
    if (kind === 'pending') {
      assert.equal(receipt.failure.cacheOwnershipReleased(), false); settled = true;
      assert.equal(receipt.failure.cacheOwnershipReleased(), true);
    }
    assert.equal((await cleanup.commitArtifactCleanup()).failedActions, 1, 'repeated receipt cannot erase a failed original action');
    assert.equal(fault.calls, 1, 'receipt inspection never retries an owned removal');
  }
} finally { fs.access = originalAccess; hook.deregister(); delete globalThis.artifactCleanupRemovalFixture; await fs.rm(dir, { recursive: true, force: true }); }
console.log('Immediate/staged removal results preserve failed targets, original causes, exact counters and pending ownership.');
