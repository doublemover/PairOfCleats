import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { runNode } from '../../helpers/run-node.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { CACHE_OWNER_FILE } from '../../../src/shared/cache-deletion.js';
import { once } from 'node:events';
import { inspectRepoCacheAccess, repoAccessPaths, withExclusiveRepoCacheCleanup } from '../../../src/shared/cache/repo-access.js';

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-repo-access-'));
const children = new Set();
const start = async (explicit = null, cleanup = false) => {
  const child = fork(path.resolve('tests/fixtures/cache/repo-access-client.js'), [path.join(temporary, 'repo'), path.join(temporary, 'cache'), ...(explicit ? [explicit] : []), ...(cleanup ? ['cleanup'] : [])], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  children.add(child);
  const [message] = await once(child, 'message');
  return { child, message };
};
const stop = async (child, crash = false) => {
  const exited = once(child, 'exit');
  if (crash) child.kill('SIGKILL'); else child.send('quit');
  await exited;
  children.delete(child);
};
const runGc = () => {
  const run = runNode(['tools/index/cache-gc.js', '--apply', '--json', '--cache-root', path.join(temporary, 'cache'), '--max-bytes', '1'],
    'online repository GC', process.cwd(), applyTestEnv({ syncProcess: false }), { stdio: 'pipe', allowFailure: true });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  return JSON.parse(run.stdout);
};
try {
  const reader = await start();
  const root = reader.message.root;
  assert.ok(root);
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, 'data'), 'retained');
  await fs.writeFile(path.join(temporary, 'cache', CACHE_OWNER_FILE), JSON.stringify({ owner: 'pairofcleats', layoutVersion: 1 }));
  const online = runGc();
  assert.equal(online.protectedRepos.length, 1);
  assert.equal(online.totals.protectedBytes, 8);
  assert.equal(online.quotaSatisfied, false);
  assert.equal(online.freedBytes, 0);
  const busy = await withExclusiveRepoCacheCleanup(root, () => assert.fail('active reader must exclude cleanup'));
  assert.equal(busy.protected, true);
  assert.equal(await fs.readFile(path.join(root, 'data'), 'utf8'), 'retained');
  await stop(reader.child, true);
  assert.deepEqual(inspectRepoCacheAccess(root), [], 'dead owners do not protect forever');
  const cleaned = await withExclusiveRepoCacheCleanup(root, async () => {
    const contender = await start();
    assert.equal(contender.message.code, 'ERR_REPO_CACHE_CLEANUP_BUSY', 'new admission must fail before cache access');
    await stop(contender.child);
    await fs.rm(root, { recursive: true, force: true });
  });
  assert.equal(cleaned.protected, false);
  const collector = await start(root, true);
  assert.equal(collector.message.locked, true);
  await stop(collector.child, true);
  const recovered = await withExclusiveRepoCacheCleanup(root, () => 'recovered');
  assert.equal(recovered.result, 'recovered', 'a subsequent collector recovers a dead local owner');
  const resumed = await start(path.join(root, 'builds', 'explicit', 'index-code'));
  assert.equal(resumed.message.root, root);
  assert.equal(inspectRepoCacheAccess(root).length, 1, 'explicit index path is leased');
  await stop(resumed.child);
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, 'data'), 'retained');
  const applied = runGc();
  assert.equal(applied.freedBytes, 8);
  assert.equal(applied.quotaSatisfied, true);
  await assert.rejects(fs.stat(root), { code: 'ENOENT' });
  const { leases, lockPath } = repoAccessPaths(root);
  await fs.writeFile(lockPath, JSON.stringify({ hostname: os.hostname(), pid: 'invalid' }));
  assert.equal((await withExclusiveRepoCacheCleanup(root, () => assert.fail('unknown collector must stay protected'))).protected, true);
  await fs.rm(lockPath);
  await fs.mkdir(leases, { recursive: true });
  await fs.writeFile(path.join(leases, 'unknown.json'), '{invalid');
  assert.equal((await withExclusiveRepoCacheCleanup(root, () => assert.fail('unknown owner must be protected'))).protected, true);
} finally {
  for (const child of children) await stop(child, true);
  await fs.rm(temporary, { recursive: true, force: true });
}
console.log('Process leases exclude live readers, reject admission during cleanup, and recover dead owners.');
