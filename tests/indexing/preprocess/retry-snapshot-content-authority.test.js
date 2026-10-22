import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { preprocessFiles } from '../../../src/index/build/preprocess.js';
import { createPreprocessSnapshotSession } from '../../../src/index/build/preprocess-snapshot.js';
import { buildIgnoreMatcher } from '../../../src/index/build/ignore.js';
import { acquireIndexLock } from '../../../src/index/build/lock.js';
import { createIndexCacheLease } from '../../../src/index/build/cache-lease.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-preprocess-retry-'));
const repo = path.join(temporary, 'repo');
const cache = path.join(temporary, 'cache');
await fs.mkdir(path.join(repo, 'nested'), { recursive: true });
await fs.mkdir(cache);
const lock = await acquireIndexLock({ repoCacheRoot: cache });
assert.ok(lock);
const lease = createIndexCacheLease(lock, cache);
const snapshotPath = path.join(cache, 'preprocess', 'snapshot.json');
const modes = ['code', 'prose', 'extracted-prose', 'records'];
const project = result => Object.fromEntries(modes.map(mode => [mode, {
  entries: result.entriesByMode[mode].map(({ rel, lines, scan, record }) => ({ rel, lines, scan, record })),
  skips: result.skippedByMode[mode].map(({ file, reason }) => [path.relative(repo, file), reason]).sort(),
  lines: [...result.lineCountsByMode[mode]].sort()
}]));
const run = async (extra = {}) => {
  const { ignoreMatcher } = await buildIgnoreMatcher({ root: repo, userConfig: {} });
  return preprocessFiles({ root: repo, modes, ignoreMatcher, lineCounts: true, concurrency: 2,
    fileScan: { sampleBytes: 8192 }, snapshotCache: { repoCacheRoot: cache, lease, buildId: 'failed-attempt' }, ...extra });
};
try {
  await fs.writeFile(path.join(repo, 'first.js'), 'let a=1;\nlet b=2;\n');
  await fs.writeFile(path.join(repo, 'nested', 'readme.md'), '# title\nbody\n');
  await fs.writeFile(path.join(repo, 'run.log'), '2026-10-22 12:00:00 start\n');
  await fs.writeFile(path.join(repo, 'small.min.js'), 'var x=1;');
  const uncached = await run({ snapshotCache: null });
  const cold = await run();
  assert.deepEqual(project(cold), project(uncached));
  assert.equal(cold.stats.retrySnapshot.snapshotState, 'sealed');
  const coldBytes = await fs.readFile(snapshotPath);
  // A later stage failed: no generation/current pointer was produced, yet this derived snapshot is reusable.
  assert.equal((await fs.readdir(cache)).includes('current.json'), false);
  const warm = await run();
  assert.deepEqual(project(warm), project(cold));
  assert.equal(warm.stats.retrySnapshot.classificationHits, 3);
  assert.equal(warm.stats.retrySnapshot.lineCountHits, 3);
  assert.equal(warm.stats.retrySnapshot.lineCountPasses || 0, 0);
  assert.ok(warm.stats.retrySnapshot.sourceBytes > 0, 'warm replay still verifies current contents');
  assert.ok(warm.stats.discovery.directoryEntries > 0, 'membership is enumerated afresh');
  const first = path.join(repo, 'first.js');
  const stamp = await fs.stat(first);
  await fs.writeFile(first, 'let a=1; let b=2; '); // Same encoded size, different line count.
  assert.equal((await fs.stat(first)).size, stamp.size);
  await fs.utimes(first, stamp.atime, stamp.mtime);
  const changed = await run();
  assert.equal(changed.stats.retrySnapshot.contentChanges, 1);
  assert.equal(changed.lineCountsByMode.code.get('first.js'), 1);
  assert.deepEqual(project(changed), project(await run({ snapshotCache: null })));
  await fs.rename(first, path.join(repo, 'renamed.js'));
  await fs.unlink(path.join(repo, 'run.log'));
  await fs.writeFile(path.join(repo, 'nested', 'new.js'), 'export {};\n');
  const delta = await run();
  assert.equal(delta.stats.retrySnapshot.membersAdded, 2);
  assert.equal(delta.stats.retrySnapshot.membersRemoved, 2);
  assert.deepEqual(project(delta), project(await run({ snapshotCache: null })));
  const policy = await run({ fileCaps: { default: { maxLines: 1 } } });
  assert.equal(policy.stats.retrySnapshot.classificationHits || 0, 0);
  assert.deepEqual(project(policy), project(await run({ snapshotCache: null, fileCaps: { default: { maxLines: 1 } } })));
  for (const transform of [() => Buffer.from('{'), bytes => {
    const envelope = JSON.parse(bytes); envelope.sha256 = '0'.repeat(64); return JSON.stringify(envelope);
  }, bytes => {
    const envelope = JSON.parse(bytes); const body = JSON.parse(envelope.bodyJson);
    body.products[0].output.skip = { reason: 'binary' };
    envelope.bodyJson = JSON.stringify(body);
    envelope.sha256 = crypto.createHash('sha256').update(envelope.bodyJson).digest('hex');
    return JSON.stringify(envelope);
  }]) {
    await fs.writeFile(snapshotPath, transform(coldBytes));
    const recomputed = await run();
    assert.equal(recomputed.stats.retrySnapshot.classificationHits || 0, 0);
    assert.deepEqual(project(recomputed), project(await run({ snapshotCache: null })));
  }
  const sealed = await fs.readFile(snapshotPath);
  const aborted = new AbortController(); aborted.abort(new Error('stop preprocessing'));
  await assert.rejects(run({ abortSignal: aborted.signal }), /stop preprocessing/);
  assert.deepEqual(await fs.readFile(snapshotPath), sealed);
  const originalOpen = fs.open;
  fs.open = async function (filename, ...args) {
    if (path.resolve(filename) === path.join(repo, 'renamed.js')) throw Object.assign(new Error('source denied'), { code: 'EACCES' });
    return originalOpen.call(this, filename, ...args);
  };
  try { await assert.rejects(run(), { code: 'EACCES' }); }
  finally { fs.open = originalOpen; }
  assert.deepEqual(await fs.readFile(snapshotPath), sealed);
  const originalLstat = fsSync.lstatSync;
  fsSync.lstatSync = function (filename, ...args) {
    const value = originalLstat.call(this, filename, ...args);
    if (path.resolve(filename) !== path.join(repo, 'renamed.js')) return value;
    return new Proxy(value, { get(target, key) {
      if (key === 'isSymbolicLink') return () => true;
      const field = Reflect.get(target, key); return typeof field === 'function' ? field.bind(target) : field;
    } });
  };
  try { await assert.rejects(run(), { code: 'ERR_UNSAFE_FILE_PATH' }); }
  finally { fsSync.lstatSync = originalLstat; }
  assert.deepEqual(await fs.readFile(snapshotPath), sealed);
  lease.invalidate();
  await assert.rejects(run(), { code: 'ERR_INDEX_CACHE_OWNERSHIP' });
  assert.deepEqual(await fs.readFile(snapshotPath), sealed);
  const metrics = {};
  assert.equal(await createPreprocessSnapshotSession({ root: repo, snapshotCache: { repoCacheRoot: cache },
    policy: { ignorePolicy: null }, sampleBytes: 4096, metrics }), null);
  assert.equal(metrics.snapshotState, 'ignore-policy-unqualified');
} finally {
  lease.invalidate();
  await lock.release();
  await fs.rm(temporary, { recursive: true, force: true });
}
console.log('preprocessing retry products require fresh contents, exact policy and owned atomic sealing');
