import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { createBuildProgressDiscovery, acquireBuildProgressDiscovery, PROGRESS_DISCOVERY_PAGE_SIZE,
  PROGRESS_DISCOVERY_INTERVAL_MS } from '../../../tools/service/indexer-service/progress-discovery.js';
import { startBuildProgressMonitor } from '../../../tools/service/indexer-service/progress-monitor.js';
import { bindClaimedJobExecution } from '../../../tools/service/indexer-service/queue-worker.js';
import { getStorageDirectorySession } from '../../../src/shared/storage/directory.js';

const { dir } = await prepareIsolatedTestCacheDir('progress-shared-discovery');
const measurements = [];
for (const retained of [1, 8, 32, PROGRESS_DISCOVERY_PAGE_SIZE * 2 + 7]) {
  const root = path.join(dir, String(retained)), builds = path.join(root, 'builds');
  const repo = path.join(root, 'repo'); await fs.mkdir(repo, { recursive: true });
  const job = bindClaimedJobExecution({ id: 'active', repo, stage: 'stage2' });
  const write = async (id, correlationId = 'old') => {
    const buildRoot = path.join(builds, id); await fs.mkdir(buildRoot, { recursive: true });
    await fs.writeFile(path.join(buildRoot, 'build_state.json'), JSON.stringify({
      buildRoot, buildId: id, repoRoot: repo, runtime: { latestAttemptId: id,
        attempts: [{ buildId: id, attemptId: id, stage: 'stage2', correlationId }] }
    }));
    return buildRoot;
  };
  for (let index = 0; index < retained; index++) await write(`retained-${index}`);
  let clock = 1;
  const owner = createBuildProgressDiscovery({ repoCacheRoot: root, now: () => clock });
  try {
    const shared = await Promise.all(Array.from({ length: 4 }, () => owner.discover()));
    assert.ok(shared.every(page => page === shared[0]));
    const initial = owner.getDiagnostics();
    assert.equal(initial.pages, 1);
    assert.equal(initial.coalesced, 3);
    assert.equal(initial.entries, Math.min(retained, PROGRESS_DISCOVERY_PAGE_SIZE));
    assert.equal(initial.stateReads, initial.entries);
    await owner.discover(); assert.equal(owner.getDiagnostics().pages, 1, 'waiting polls use bounded backoff');
    let previous = initial;
    while (owner.getDiagnostics().entries < retained || owner.getDiagnostics().cursorOpen) {
      clock += PROGRESS_DISCOVERY_INTERVAL_MS;
      await owner.discover();
      const next = owner.getDiagnostics();
      assert.ok(next.entries - previous.entries <= PROGRESS_DISCOVERY_PAGE_SIZE);
      assert.ok(next.stateReads - previous.stateReads <= PROGRESS_DISCOVERY_PAGE_SIZE);
      assert.ok(next.retainedHints <= PROGRESS_DISCOVERY_PAGE_SIZE);
      previous = next;
    }
    assert.equal(owner.getDiagnostics().cycles, 1);
    assert.equal(owner.getDiagnostics().stateReads, retained, 'incremental pages reach every retained root exactly once per cycle');
    measurements.push({ retained, waitingMonitors: 4, ...owner.getDiagnostics() });
  } finally { await owner.close(); }

  const selected = await write('current', job.observability.correlation.correlationId);
  if (retained <= 32) {
    const monitors = Array.from({ length: 2 }, (_, index) => startBuildProgressMonitor({
      job: { ...job, id: `compat-${index}` }, repoPath: repo, stage: 'stage2', repoCacheRoot: root, log: () => {}
    }));
    try {
      await Promise.all(monitors.map(stop => stop.poll()));
      for (const stop of monitors) {
        const work = stop.getDiagnostics();
        assert.equal(work.binding.buildRoot, selected);
        assert.equal(work.discovery.cycles, 1);
        assert.equal(work.discovery.stateReads, retained + 1, 'actual monitors share startup state reads');
      }
      const foreign = JSON.parse(await fs.readFile(path.join(selected, 'build_state.json')));
      foreign.runtime.attempts[0].correlationId = 'foreign-new-attempt';
      await fs.writeFile(path.join(selected, 'build_state.json'), JSON.stringify(foreign));
      for (const stop of monitors) { await stop.poll(); assert.equal(stop.getDiagnostics().binding, null); }
      for (const stop of monitors) { await stop.poll(); assert.equal(stop.getDiagnostics().binding, null,
        'a cached compatibility hint cannot certify changed on-disk ownership'); }
    } finally { for (const stop of monitors) await stop(); }
  }
}

// Last subscriber shutdown drains the exact in-flight directory read and its
// original close; releasing one subscriber must not close a sibling's cursor.
const root = path.join(dir, 'close'), builds = path.join(root, 'builds');
await fs.mkdir(builds, { recursive: true }); await fs.mkdir(path.join(builds, 'one'));
const originalOpenDir = fs.opendir, entered = Promise.withResolvers(), release = Promise.withResolvers();
let nativeCloses = 0;
fs.opendir = async (...args) => {
  const handle = await originalOpenDir(...args), read = handle.read, close = handle.close;
  handle.read = async function(...values) { entered.resolve(); await release.promise; return read.call(handle, ...values); };
  handle.close = async function(...values) { nativeCloses++; return close.call(handle, ...values); };
  return handle;
};
const left = acquireBuildProgressDiscovery({ repoCacheRoot: root }), right = acquireBuildProgressDiscovery({ repoCacheRoot: root });
try {
  const scanning = left.discover(); await entered.promise;
  await left.release(); assert.equal(nativeCloses, 0);
  let closed = false; const closing = right.release().then(() => { closed = true; });
  await Promise.resolve(); await Promise.resolve(); assert.equal(closed, false);
  release.resolve(); await scanning; await closing;
  assert.equal(nativeCloses, 1); assert.equal(closed, true);
} finally { release.resolve(); await left.release(); await right.release(); fs.opendir = originalOpenDir; }

const failedRoot = path.join(dir, 'failed-close');
await fs.mkdir(path.join(failedRoot, 'builds'), { recursive: true });
let rejectClose = true;
fs.opendir = async (...args) => {
  const handle = await originalOpenDir(...args), close = handle.close;
  handle.close = async function(...values) {
    if (rejectClose) throw Object.assign(new Error('expected original directory close failure'), { code: 'EIO' });
    return close.call(handle, ...values);
  };
  return handle;
};
const failedOwner = acquireBuildProgressDiscovery({ repoCacheRoot: failedRoot });
let failure;
try {
  await assert.rejects(failedOwner.discover());
  try { await failedOwner.release(); } catch (error) { failure = error; }
  assert.ok(failure);
  assert.equal(failure.cacheOwnershipReleased(), false);
  assert.throws(() => acquireBuildProgressDiscovery({ repoCacheRoot: failedRoot }),
    error => error.cacheOwnershipReleased() === false, 'a failed close cannot be bypassed with a new cursor owner');
  const session = getStorageDirectorySession(failure); assert.ok(session);
  rejectClose = false;
  await session.releaseAfterClose();
  assert.equal(failure.cacheOwnershipReleased(), true);
  const recovered = acquireBuildProgressDiscovery({ repoCacheRoot: failedRoot });
  await recovered.discover(); await recovered.release();
} finally {
  rejectClose = false;
  const session = failure && getStorageDirectorySession(failure);
  if (session && !session.isSettled()) await session.releaseAfterClose();
  fs.opendir = originalOpenDir;
}
console.log(JSON.stringify({ kind: 'service-progress-work', measurements }));
console.log('Compatibility discovery shares bounded incremental pages, backoff and confirmed directory cleanup across waiting monitors.');
