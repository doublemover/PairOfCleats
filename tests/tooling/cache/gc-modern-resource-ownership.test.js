import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { cacheGc } from '../../../tools/mcp/tools/handlers/artifacts.js';
import { CACHE_OWNER_FILE } from '../../../src/shared/cache-deletion.js';
import { resolveRepoCacheRootPath } from '../../../src/shared/repo-paths.js';
import { acquireRepoStorageSession } from '../../../src/shared/storage/repository-session.js';
import { withExclusiveStorageAccess } from '../../../src/shared/storage/access.js';
import { acquireRepoCacheAccessLease, repoAccessPaths } from '../../../src/shared/cache/repo-access.js';
import { withGeneratedCacheMetadata } from '../../../src/shared/generated-artifact-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('gc-modern-resource-ownership/')[1];
assert.ok(['live', 'unknown', 'admission-race', 'exclusion-barrier'].includes(selected));
const temporary = await makeTempDir(`gc-modern-${selected}-`), temporaryParent = path.dirname(temporary);
const repo = path.join(temporary, 'repo'), cacheRoot = path.join(temporary, 'cache'), home = path.join(temporary, 'home');
await fs.mkdir(repo); await fs.mkdir(cacheRoot);
const userConfig = { cache: { root: cacheRoot } };
await fs.writeFile(path.join(repo, '.pairofcleats.json'), JSON.stringify(userConfig));
await fs.writeFile(path.join(cacheRoot, CACHE_OWNER_FILE), JSON.stringify({ owner: 'pairofcleats', layoutVersion: 1 }));
const env = applyTestEnv({ cacheRoot, extraEnv: { PAIROFCLEATS_HOME: home, PAIROFCLEATS_TRUSTED_CONFIG: null } });
const repoCacheRoot = resolveRepoCacheRootPath(repo, userConfig), coordinationRoot = path.join(home, 'state', 'storage-access');
const sentinel = path.join(repoCacheRoot, 'tree-sitter-chunk-cache', `tree-sitter-chunk_lk1_${'a'.repeat(40)}.json`);
const bytes = JSON.stringify(withGeneratedCacheMetadata({ chunks: [] }, 'tree-sitter-chunks'));
await fs.mkdir(path.dirname(sentinel), { recursive: true }); await fs.writeFile(sentinel, bytes);
const admit = () => acquireRepoStorageSession(repoCacheRoot, { repoRoot: repo, userConfig, env }).session;
const release = session => session.releaseAfterSettlement({ resourceId: session.resourceId, settled: true, pending: false });
const cli = extra => {
  const child = runNode([path.resolve('tools/index/cache-gc.js'), '--repo', repo, '--cache-root', cacheRoot,
    '--max-age-days', '0', '--json', ...extra], 'actual GC modern owner admission', process.cwd(), env,
  { stdio: 'pipe', allowFailure: true, timeoutMs: 10000 });
  assert.equal(child.status, 0, child.stderr || child.stdout);
  return JSON.parse(child.stdout);
};
const requirePreserved = async result => {
  assert.equal(result.freedBytes, 0);
  assert.equal(await fs.readFile(sentinel, 'utf8'), bytes, 'the original lazy reader input survives GC');
};
let session, reader, unknown;
const open = fs.open, log = console.log, argv = process.argv;
try {
  if (selected === 'live' || selected === 'unknown') {
    if (selected === 'live') {
      session = admit(); reader = await fs.open(sentinel, 'r');
    } else {
      const leases = repoAccessPaths(repoCacheRoot, { coordinationRoot }).leases;
      await fs.mkdir(leases, { recursive: true });
      unknown = path.join(leases, 'unknown-resource.json'); await fs.writeFile(unknown, '{');
    }
    const preview = cli([]);
    const applied = cli(['--apply']);
    await requirePreserved(preview); await requirePreserved(applied);
    for (const result of [preview, applied]) {
      assert.deepEqual(result.removals, []);
      assert.equal(result.protectedRepos.length, 1);
      assert.equal(result.protectedRepos[0].reason, 'active-or-unknown-resource');
    }
    await requirePreserved(await cacheGc({ repoPath: repo, maxBytes: 1, dryRun: false }));
    if (reader) { assert.equal(await reader.readFile('utf8'), bytes); await reader.close(); reader = null; }
    if (session) { release(session); session = null; }
    if (unknown) { await fs.unlink(unknown); unknown = null; }
    assert.equal(cli([]).removals.length, 1, 'confirmed release restores the original positive preview');
    assert.equal(await fs.readFile(sentinel, 'utf8'), bytes);
    const removed = cli(['--apply']);
    assert.equal(removed.freedBytes, Buffer.byteLength(bytes));
    await assert.rejects(fs.stat(repoCacheRoot), { code: 'ENOENT' });
  } else {
    process.argv = [process.execPath, path.resolve('tools/index/cache-gc.js'), '--repo', repo, '--cache-root', cacheRoot,
      '--apply', '--max-age-days', '0', '--json'];
    const { runCacheGc } = await import('../../../tools/index/cache-gc.js');
    process.argv = argv;
    const legacyLock = repoAccessPaths(repoCacheRoot).lockPath;
    const modernLock = repoAccessPaths(repoCacheRoot, { coordinationRoot }).lockPath;
    let injected = false, checkedBarrier = false;
    fs.open = async (target, ...args) => {
      if (selected === 'admission-race' && !injected && target === legacyLock) {
        injected = true; session = admit();
      }
      if (selected === 'exclusion-barrier' && target === sentinel && fsSync.existsSync(modernLock) && !checkedBarrier) {
        checkedBarrier = true;
        assert.throws(admit, { code: 'ERR_REPO_CACHE_CLEANUP_BUSY' });
        assert.throws(() => acquireRepoCacheAccessLease(repoCacheRoot), { code: 'ERR_REPO_CACHE_CLEANUP_BUSY' });
        const category = await withExclusiveStorageAccess(cacheRoot,
          () => assert.fail('whole-category migration must not overtake admitted GC'), { coordinationRoot });
        assert.equal(category.protected, true);
      }
      return open(target, ...args);
    };
    const output = [];
    console.log = value => { output.push(value); };
    await runCacheGc({ repoOnly: true });
    console.log = log; fs.open = open;
    assert.equal(output.length, 1);
    const result = JSON.parse(output[0]);
    if (selected === 'admission-race') {
      assert.equal(injected, true, 'admit a real modern resource after GC planning but before legacy exclusion');
      await requirePreserved(result);
      assert.equal(result.failedRemovals[0].code, 'ERR_CACHE_IN_USE');
      release(session); session = null;
      assert.equal(cli(['--apply']).freedBytes, Buffer.byteLength(bytes));
    } else {
      assert.equal(checkedBarrier, true, 'actual file requalification must run inside both cleanup barriers');
      assert.equal(result.ok, true);
      assert.equal(result.freedBytes, Buffer.byteLength(bytes));
    }
    await assert.rejects(fs.stat(repoCacheRoot), { code: 'ENOENT' });
  }
} finally {
  fs.open = open; console.log = log; process.argv = argv;
  if (reader) await reader.close();
  if (session) release(session);
  if (unknown) await fs.unlink(unknown);
  assert.equal(path.dirname(temporary), temporaryParent);
  await rmDirRecursive(temporary);
}
console.log(`Actual cache GC ${selected} respects original storage sessions and both exclusion namespaces.`);
