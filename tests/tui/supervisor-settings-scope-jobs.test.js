import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createSupervisorSession } from '../helpers/supervisor-session.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { initGitRepo } from '../helpers/git-fixture.js';

const { dir } = await prepareIsolatedTestCacheDir('supervisor-settings-scope-jobs');
const repositories = [path.join(dir, 'first'), path.join(dir, 'second')];
for (const repo of repositories) { await fs.mkdir(repo); initGitRepo(repo); }
await fs.writeFile(path.join(repositories[1], '.pairofcleats.json'), '{"threads":3}');
applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'off' });
const session = createSupervisorSession({ reassembleEvents: true });
const select = async (target, jobId) => {
  session.send({ op: 'settings:run', jobId, method: 'select', params: { kind: 'repo', target } });
  const end = await session.waitForEvent(row => row.event === 'job:end' && row.jobId === jobId);
  assert.equal(end.status, 'done'); return end.result.data;
};
try {
  await session.waitForEvent(row => row.event === 'hello');
  const first = await select(repositories[0], 'scope-first');
  const release = path.join(dir, 'release-owned-child');
  // Explicit fixture command holds a real child across scope selection; only
  // that owned child reads the disposable release marker.
  session.send({ op: 'job:run', jobId: 'old-scope', command: process.execPath,
    args: ['-e', `const fs=require('node:fs');const timer=setInterval(()=>{if(fs.existsSync(process.argv[1])){
      clearInterval(timer);process.stdout.write(JSON.stringify({cwd:process.cwd()}));}},20);`, release],
    cwd: first.configRoot, timeoutMs: 5000, resultPolicy: { captureStdout: 'json', maxBytes: 8192 } });
  await session.waitForEvent(row => row.event === 'job:spawn' && row.jobId === 'old-scope');
  const second = await select(repositories[1], 'scope-second');
  assert.equal(session.events.some(row => row.event === 'job:end' && row.jobId === 'old-scope'), false,
    'scope changes occur while the existing child remains active');
  await fs.writeFile(release, 'release');
  const oldEnd = await session.waitForEvent(row => row.event === 'job:end' && row.jobId === 'old-scope');
  assert.equal(oldEnd.status, 'done'); assert.equal(oldEnd.result.cwd, first.configRoot);
  session.send({ op: 'job:run', jobId: 'new-scope', argv: ['config', 'dump', '--repo', second.configRoot, '--json'],
    cwd: second.configRoot, timeoutMs: 10000, resultPolicy: { captureStdout: 'json', maxBytes: 1024 * 1024 } });
  const newEnd = await session.waitForEvent(row => row.event === 'job:end' && row.jobId === 'new-scope', 12000);
  assert.equal(newEnd.status, 'done'); assert.equal(newEnd.resultState, 'complete');
  assert.equal(newEnd.result.userConfig.threads, 3);
  assert.equal(await session.shutdown(), 0);
} finally { session.forceKill(); }
console.log('Real scope switching preserves an active child cwd and binds the next canonical command independently');
