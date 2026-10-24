import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { bindArtifactScope, createTuiArtifactRegistry } from '../../tools/tui/operator/artifact-registry.js';
import { createTuiArtifactActions } from '../../tools/tui/operator/artifacts.js';
import { createTuiSearchSession } from '../../tools/tui/operator/search.js';
import { disposeTuiSessionSlot } from '../../tools/tui/operator/backend-reader-drain.js';
import { getContainedFileSession } from '../../src/shared/contained-file.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { applyTestEnv } from '../helpers/test-env.js';

// Actual operator/collector and tiny FileHandles. Faults are inert and never
// constitute subprocess, native terminal or backend qualification.
const { dir } = await prepareIsolatedTestCacheDir('tui-reader-retirement');
const repo = path.join(dir, 'repo'), target = path.join(repo, 'report.json');
await fs.mkdir(repo); await fs.writeFile(target, '{"retained":true}');
const env = applyTestEnv({ cacheRoot: path.join(dir, 'cache'), syncProcess: false,
  extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
const originalOpen = fs.open, nativeClosers = [];
const rejected = async action => {
  let failed = false, failure;
  try { await action(); } catch (error) { failed = true; failure = error; }
  assert.equal(failed, true); return failure;
};
const failClose = () => {
  let allow = false, opens = 0, reads = 0;
  fs.open = async (...args) => {
    const handle = await originalOpen(...args);
    if (path.resolve(String(args[0])) !== target) return handle;
    opens++;
    const close = handle.close.bind(handle), read = handle.read.bind(handle); nativeClosers.push(close);
    handle.read = (...input) => { reads++; return read(...input); };
    handle.close = async () => { if (!allow) throw new Error('original report descriptor close rejected'); return close(); };
    return handle;
  };
  return { permit: () => { allow = true; }, counts: () => ({ opens, reads }) };
};
try {
  {
    const registry = createTuiArtifactRegistry(), generation = registry.beginJob('failed-collector');
    const fault = failClose();
    const failure = await rejected(() => registry.capture({ sourceJobId: 'failed-collector', generation,
      artifacts: [bindArtifactScope({ path: target }, { root: repo, repoRoot: repo })] }));
    assert.equal(failure.cacheOwnershipReleased(), false);
    assert.throws(() => registry.beginJob('replacement'), error => error === failure,
      'an unavailable row cannot conceal an original retained descriptor');
    assert.equal(await rejected(() => registry.dispose()), failure);
    fault.permit(); await getContainedFileSession(failure).releaseAfterClose();
    await registry.dispose(); assert.deepEqual(fault.counts(), { opens: 1, reads: 1 }, 'close-only recovery never rereads the report');
    fs.open = originalOpen;
  }
  {
    const registry = createTuiArtifactRegistry(), generation = registry.beginJob('export-source');
    const inventory = await registry.capture({ sourceJobId: 'export-source', generation,
      artifacts: [bindArtifactScope({ path: target }, { root: repo, repoRoot: repo })] });
    const actions = createTuiArtifactActions({ registry, toolRoot: process.cwd(), env });
    const fault = failClose();
    const request = { sourceJobId: 'export-source', inventoryId: generation,
      artifactId: inventory.artifacts[0].artifactId, destination: 'not-published.json', confirmed: true };
    const failure = await rejected(() => actions.execute('export', request));
    assert.equal(await rejected(() => actions.dispose()), failure, 'a rejected operation remains owned after its promise leaves work');
    assert.equal(await rejected(() => registry.dispose()), failure);
    await assert.rejects(fs.access(path.join(repo, 'not-published.json')), { code: 'ENOENT' });
    fault.permit(); await getContainedFileSession(failure).releaseAfterClose();
    await actions.dispose(); await registry.dispose(); assert.deepEqual(fault.counts(), { opens: 1, reads: 1 });
    fs.open = originalOpen;
  }
  {
    let settled = false, calls = 0;
    const original = Object.assign(new Error('original search child settlement remains pending'), {
      cacheOwnershipPending: false, cacheOwnershipReleased() { assert.equal(this, original); return settled; }
    });
    const session = createTuiSearchSession({ toolRoot: process.cwd(), env,
      spawn: async () => { calls++; throw original; } });
    const request = { repoPath: repo, search: { query: 'needle', mode: 'code', backend: 'auto' } };
    assert.equal(await rejected(() => session.query(request)), original);
    original.cacheOwnershipReleased = () => true;
    assert.equal(await rejected(() => session.query(request)), original);
    assert.equal(calls, 1, 'a new query cannot acquire another child around a retained failure');
    let slot = session;
    const dispose = () => disposeTuiSessionSlot({ current: () => slot, replace: value => { slot = value; } });
    assert.equal(await rejected(dispose), original); assert.equal(slot, session);
    settled = true; await dispose(); assert.equal(slot, null);
  }
  {
    let settle, announce;
    const started = new Promise(resolve => { announce = resolve; });
    let nativeSettled = false;
    const original = Object.assign(new Error('cancelled original search work remains pending'), {
      cacheOwnershipPending: true, cacheOwnershipReleased: () => nativeSettled
    });
    const session = createTuiSearchSession({ toolRoot: process.cwd(), env, spawn: async (_command, _args, options) => {
      announce(); return new Promise((_resolve, reject) => {
        settle = () => reject(original); options.signal.addEventListener('abort', settle, { once: true });
      });
    } });
    const running = session.query({ repoPath: repo, search: { query: 'needle' } });
    const requestFailure = rejected(() => running);
    await started;
    assert.equal(await rejected(() => session.dispose()), original,
      'disposal must capture the rejection caused by its own abort before returning a drain receipt');
    assert.equal(await requestFailure, original);
    nativeSettled = true; await session.dispose();
  }
} finally {
  fs.open = originalOpen;
  for (const close of nativeClosers) { try { await close(); } catch {} }
}
console.log('Actual native search/artifact readers preserve original retirement across rejected work and drain.');
