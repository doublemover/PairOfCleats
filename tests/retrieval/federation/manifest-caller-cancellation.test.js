import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runFederatedSearch } from '../../../src/retrieval/federation/coordinator.js';
import { search } from '../../../src/integrations/core/search.js';
import { loadWorkspaceConfig } from '../../../src/workspace/config.js';
import { generateWorkspaceManifest, getWorkspaceManifestPath } from '../../../src/workspace/manifest.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';
import { createCompatibilityIndex } from '../../helpers/index-compatibility-fixture.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { writeFederationRepoFixture } from './repo-fixture.js';

const selectedCase = process.env.PAIROFCLEATS_TEST_ID?.split('retrieval/federation/manifest-caller-cancellation/')[1];
assert.ok(['initial', 'ranked-revalidation', 'enumeration-revalidation', 'pending-reader', 'pre-aborted'].includes(selectedCase));
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const { dir } = await prepareIsolatedTestCacheDir(`federation-manifest-cancel-${selectedCase}`);
const cacheRoot = path.join(dir, 'cache'), workspacePath = path.join(dir, 'workspace.json');
applyTestEnv({ cacheRoot, embeddings: 'off' });
const originalOpen = fs.open, admitted = gate(), release = gate(), ownedHandles = new Set();
let active = selectedCase !== 'ranked-revalidation' && selectedCase !== 'enumeration-revalidation';
let calls = 0, opensAfterAbort = 0, nativeCloses = 0, pending = null, primary = null, ready = false;
let atAdmission = null;
const controller = new AbortController();
try {
  const members = [];
  for (const leaf of ['a', 'b']) {
    const repoRoot = path.join(dir, leaf);
    const descriptor = await writeFederationRepoFixture({ repoRoot, cacheRoot, modes: ['code'] });
    const indexDir = await createCompatibilityIndex(descriptor.buildRoot, { mode: 'code', compatibilityKey: 'cancel-compatible' });
    await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), JSON.stringify([{ id: 0, file: 'input.js', name: leaf,
      chunkUid: `cancel:${leaf}`, kind: 'FunctionDeclaration', start: 0, end: 5, tokens: ['alpha'] }]));
    members.push({ root: `./${leaf}`, pointer: path.join(descriptor.repoCacheRoot, 'builds/current.json') });
  }
  await fs.writeFile(workspacePath, JSON.stringify({ schemaVersion: 1, cacheRoot: './cache', repos: members.map(({ root }) => ({ root })) }));
  const workspace = loadWorkspaceConfig(workspacePath), manifestPath = getWorkspaceManifestPath(workspace);
  await generateWorkspaceManifest(workspace, { write: true });
  const previous = await fs.readFile(manifestPath);
  const pointers = members.map(member => path.resolve(member.pointer).toLowerCase());
  const failure = Object.freeze(Object.assign(new Error('original manifest reader still borrowed'), {
    code: 'EIO', cacheOwnershipPending: true, cacheOwnershipReleased() { assert.equal(this, failure); return ready; }
  }));
  fs.open = async function (target, ...args) {
    if (controller.signal.aborted) opensAfterAbort++;
    const handle = await originalOpen.call(this, target, ...args);
    if (!active || typeof target !== 'string' || !pointers.includes(path.resolve(target).toLowerCase())) return handle;
    active = false;
    ownedHandles.add(handle); atAdmission = await fs.readFile(manifestPath); admitted.resolve(); await release.promise;
    return { fd: handle.fd, stat: handle.stat.bind(handle), read: async (...readArgs) => {
      if (selectedCase === 'pending-reader') { controller.abort(); throw failure; }
      return handle.read(...readArgs);
    }, close: async () => { nativeCloses++; await handle.close(); ownedHandles.delete(handle); } };
  };
  const request = { workspacePath, strict: true, ...(selectedCase === 'enumeration-revalidation' ? {} : { query: 'alpha' }),
    search: { backend: 'memory', mode: 'code', ...(selectedCase === 'enumeration-revalidation' ? { type: 'FunctionDeclaration' } : {}) } };
  const searchFn = async (...args) => {
    calls++; const result = await search(...args);
    if (selectedCase.endsWith('revalidation')) active = true;
    return result;
  };
  if (selectedCase === 'pre-aborted') controller.abort();
  pending = runFederatedSearch(request, { signal: controller.signal, searchFn, searchPolicyId: 'manifest-cancel-fixture' });
  pending.catch(() => {});
  if (selectedCase !== 'pre-aborted') {
    await admitted.promise;
    if (selectedCase !== 'pending-reader') {
      controller.abort();
      let settled = false; pending.finally(() => { settled = true; }).catch(() => {});
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(settled, false, 'the caller retains an already admitted native open until it settles');
    }
    release.resolve();
  }
  await assert.rejects(pending, error => {
    primary = error;
    if (selectedCase === 'pending-reader') return error.cacheOwnershipPending === true && errorGraphIncludes(error, failure);
    return error.code === 'CANCELLED';
  });
  assert.equal(opensAfterAbort, 0, 'no later member, mode or publication is admitted after cancellation');
  assert.equal(calls, selectedCase === 'ranked-revalidation' ? 2 : selectedCase === 'enumeration-revalidation' ? 1 : 0);
  if (selectedCase === 'initial' || selectedCase === 'pending-reader' || selectedCase === 'pre-aborted') {
    assert.deepEqual(await fs.readFile(manifestPath), previous, 'cancelled initial inspection cannot replace the manifest');
  }
  if (atAdmission) assert.deepEqual(await fs.readFile(manifestPath), atAdmission,
    'cancelled revalidation never replaces the already published manifest');
  if (selectedCase === 'pending-reader') {
    assert.equal(nativeCloses, 0); assert.equal(primary.cacheOwnershipReleased(), false);
    ready = true; await getContainedFileSession(primary).releaseAfterClose();
    assert.equal(nativeCloses, 1); assert.equal(primary.cacheOwnershipReleased(), true);
  } else if (selectedCase !== 'pre-aborted') assert.equal(nativeCloses, 1);
} finally {
  fs.open = originalOpen; release.resolve();
  await Promise.allSettled([pending]);
  await Promise.allSettled([...ownedHandles].map(handle => handle.close()));
  await fs.rm(dir, { recursive: true, force: true });
}
console.log(`Actual federation ${selectedCase} forwards cancellation and retains original manifest-reader ownership.`);
