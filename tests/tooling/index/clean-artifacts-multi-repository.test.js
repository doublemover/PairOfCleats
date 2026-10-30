import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { cleanArtifacts } from '../../../tools/mcp/tools/handlers/artifacts.js';
import { resolveRepoPath } from '../../../tools/mcp/repo.js';
import { resolveRepoCacheRootPath } from '../../../src/shared/repo-paths.js';
import { acquireRepoCacheAccessLease, repoAccessPaths } from '../../../src/shared/cache/repo-access.js';
import { acquireIndexLock } from '../../../src/index/build/lock.js';
import { acquireNativeReaderStorage } from '../../../src/shared/storage/native-reader.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { CACHE_OWNER_FILE } from '../../../src/shared/cache-deletion.js';
import { withGeneratedCacheMetadata } from '../../../src/shared/generated-artifact-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';
import { rmDirRecursive } from '../../helpers/temp.js';
import { runWithTimeout } from '../../../src/shared/promise-timeout.js';
import { skip } from '../../helpers/skip.js';
import { registerChildProcessForCleanup } from '../../../src/shared/subprocess/tracking-register.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['reader', 'windows-locked-reader', 'builder', 'unknown-owner', 'saved-evidence', 'custom-sqlite', 'custom-lmdb', 'selected-repository'].includes(selected));
if (selected === 'windows-locked-reader' && process.platform !== 'win32') {
  skip('Windows native sharing qualification; portable reader, builder and custom-backend cases run separately.');
}
const temporaryParent = path.resolve('.tmp/tasks');
await fs.mkdir(temporaryParent, { recursive: true });
const temporary = await fs.mkdtemp(path.join(temporaryParent, 'cleanup-multi-'));
const cacheRoot = path.join(temporary, 'cache');
const home = path.join(temporary, 'home');
await fs.mkdir(cacheRoot);
await fs.writeFile(path.join(cacheRoot, CACHE_OWNER_FILE), JSON.stringify({ owner: 'pairofcleats', layoutVersion: 1 }));
const repos = [];
for (const name of ['protected', 'eligible']) {
  const repoRoot = path.join(temporary, name);
  await fs.mkdir(repoRoot);
  // Use a real tiny repository: an empty .git directory is not a Git root and
  // can still resolve to the enclosing author checkout.
  const initialized = spawnSync('git', ['init', '--quiet', repoRoot],
    { windowsHide: true, encoding: 'utf8', timeout: 5000 });
  assert.equal(initialized.status, 0, initialized.stderr);
  const userConfig = { cache: { root: cacheRoot } };
  const repoCacheRoot = resolveRepoCacheRootPath(repoRoot, userConfig);
  const sentinel = path.join(repoCacheRoot, 'tree-sitter-chunk-cache', `tree-sitter-chunk_lk1_${'a'.repeat(40)}.json`);
  const bytes = JSON.stringify(withGeneratedCacheMetadata({ chunks: [] }, 'tree-sitter-chunks'));
  await fs.mkdir(path.dirname(sentinel), { recursive: true });
  await fs.writeFile(sentinel, bytes);
  await fs.writeFile(path.join(repoRoot, '.pairofcleats.json'), JSON.stringify(userConfig));
  repos.push({ repoRoot, userConfig, repoCacheRoot, sentinel, bytes });
}
const [protectedRepo, eligibleRepo] = repos;
const env = applyTestEnv({ cacheRoot, extraEnv: { PAIROFCLEATS_HOME: home, PAIROFCLEATS_TRUSTED_CONFIG: null } });
assert.equal(path.relative(protectedRepo.repoRoot, resolveRepoPath(protectedRepo.repoRoot)), '',
  'MCP and CLI must select the same disposable repository');
const cli = args => runNode([path.resolve('tools/index/clean-artifacts.js'), '--repo', protectedRepo.repoRoot, ...args],
  'actual multi-repository cleanup', process.cwd(), env, { stdio: 'pipe', allowFailure: true, timeoutMs: 10000 });
let release = async () => {};
try {
  if (selected === 'selected-repository') {
    const preview = await cleanArtifacts({ repoPath: protectedRepo.repoRoot, dryRun: true });
    assert.equal(path.relative(protectedRepo.repoRoot, preview.repoPath), '');
    for (const repo of repos) assert.equal(await fs.readFile(repo.sentinel, 'utf8'), repo.bytes);
    const result = await cleanArtifacts({ repoPath: protectedRepo.repoRoot });
    assert.equal(path.relative(protectedRepo.repoRoot, result.repoPath), '');
    await assert.rejects(fs.stat(protectedRepo.repoCacheRoot), { code: 'ENOENT' });
    assert.equal(await fs.readFile(eligibleRepo.sentinel, 'utf8'), eligibleRepo.bytes,
      'repository-scoped MCP cleanup leaves its independently eligible sibling');
    assert.equal(cli([]).status, 0);
    assert.equal(await fs.readFile(eligibleRepo.sentinel, 'utf8'), eligibleRepo.bytes);
    const final = cli(['--all']);
    assert.equal(final.status, 0, final.stderr);
    await assert.rejects(fs.stat(eligibleRepo.repoCacheRoot), { code: 'ENOENT' });
  } else if (selected.startsWith('custom-')) {
    const backend = selected.slice('custom-'.length);
    const directory = path.join(temporary, 'custom-store');
    await fs.mkdir(directory);
    const target = path.join(directory, backend === 'sqlite' ? 'index-code.db' : 'index-code');
    protectedRepo.userConfig[backend] = { dbDir: directory };
    // Backend overrides are internal effective settings, not public schema
    // additions. Exercise real CLI/MCP dispatch through the existing test gate.
    Object.assign(env, applyTestEnv({ cacheRoot, testConfig: { [backend]: { dbDir: directory } },
      extraEnv: { PAIROFCLEATS_HOME: home, PAIROFCLEATS_TRUSTED_CONFIG: null } }));
    let nativeClosed = false;
    const owner = acquireNativeReaderStorage(target, { repoRoot: protectedRepo.repoRoot,
      userConfig: protectedRepo.userConfig, env, nativeBackend: backend, nativeMode: 'code',
      nativePublicationIdentity: 'caller-label-is-not-deletion-authority' }, () => nativeClosed);
    owner.start();
    let database;
    release = async () => {
      if (!nativeClosed) { if (database) await database.close(); nativeClosed = true; }
      owner.releaseAfterClosure();
    };
    const require = createRequire(import.meta.url);
    let read;
    if (backend === 'sqlite') {
      database = new (require('better-sqlite3'))(target);
      database.pragma('journal_mode = WAL');
      database.exec("CREATE TABLE sentinel (value TEXT); INSERT INTO sentinel VALUES ('original native bytes')");
      read = () => database.prepare('SELECT value FROM sentinel').get().value;
    } else {
      database = require('lmdb').open({ path: target });
      await database.put('sentinel', 'original native bytes');
      read = () => database.get('sentinel');
    }
    assert.equal((await inspectStorageAccess(target, { coordinationRoot: path.join(home, 'state', 'storage-access') })).protected, true);
    const preview = cli(['--all', '--dry-run']);
    assert.equal(preview.status, 1, preview.stderr);
    for (const repo of repos) assert.equal(await fs.readFile(repo.sentinel, 'utf8'), repo.bytes);
    const result = cli(['--all']);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /category cleanup owner required/);
    assert.match(result.stderr, /Cleanup partial/);
    assert.equal(read(), 'original native bytes', 'custom reader remains usable after all-repository cleanup');
    await assert.rejects(cleanArtifacts({ repoPath: protectedRepo.repoRoot }), /retained-protected|Cleanup partial/);
    assert.equal(read(), 'original native bytes', 'MCP must preserve the same native input');
    for (const repo of repos) await assert.rejects(fs.stat(repo.repoCacheRoot), { code: 'ENOENT' });
    await release();
    const idle = cli(['--all']);
    assert.equal(idle.status, 1, idle.stderr);
    assert.match(idle.stderr, /category cleanup owner required/);
    assert.ok(await fs.stat(target), 'absence of readers and caller generation labels do not grant deletion');
  } else {
    if (selected === 'reader' || selected === 'windows-locked-reader') {
      const lease = acquireRepoCacheAccessLease(protectedRepo.repoCacheRoot);
      release = async () => { assert.equal(lease.release(), true); };
      if (selected === 'windows-locked-reader') {
        const child = spawn('pwsh.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File',
          path.resolve('tests/fixtures/storage/windows-locked-reader.ps1'), '-Path', protectedRepo.sentinel],
        { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        registerChildProcessForCleanup(child, { scope: 'cleanup-native-locked-reader', command: 'pwsh.exe' });
        const closed = once(child, 'close');
        closed.catch(() => {});
        const ready = Promise.withResolvers();
        let stdout = '', stderr = '';
        child.stdin.on('error', error => { stderr += `stdin: ${error.message}`; });
        child.stdout.on('data', bytes => {
          stdout += bytes;
          if (stdout.split(/\r?\n/).includes('reader-ready')) ready.resolve();
        });
        child.stderr.on('data', bytes => { stderr += bytes; });
        child.on('error', ready.reject);
        child.on('close', () => ready.reject(new Error(`Reader exited before readiness: ${stderr}`)));
        const releaseLease = release;
        let released = false;
        release = async () => {
          if (released) return;
          if (!child.stdin.destroyed) child.stdin.end('\n');
          const [code, signal] = await runWithTimeout(() => closed, { timeoutMs: 5000 });
          await releaseLease(); released = true;
          assert.equal(code, 0, stderr); assert.equal(signal, null);
          assert.equal(stderr, '');
          assert.ok(stdout.includes(protectedRepo.bytes), 'original child lazily reads retained input before native close');
        };
        await runWithTimeout(() => ready.promise, { timeoutMs: 5000 });
        await assert.rejects(fs.rename(protectedRepo.sentinel, `${protectedRepo.sentinel}.probe`),
          error => ['EPERM', 'EACCES', 'EBUSY'].includes(error.code), 'actual Windows handle must deny delete/rename sharing');
      }
    } else if (selected === 'builder') {
      const lock = await acquireIndexLock({ repoCacheRoot: protectedRepo.repoCacheRoot,
        storageContext: { repoRoot: protectedRepo.repoRoot, userConfig: protectedRepo.userConfig } });
      assert.ok(lock);
      release = () => lock.release();
    } else if (selected === 'unknown-owner') {
      const leases = repoAccessPaths(protectedRepo.repoCacheRoot, { coordinationRoot: path.join(home, 'state', 'storage-access') }).leases;
      await fs.mkdir(leases, { recursive: true });
      const unknown = path.join(leases, 'unknown-owner.json');
      await fs.writeFile(unknown, '{');
      release = () => fs.unlink(unknown);
    } else {
      const saved = path.join(protectedRepo.repoCacheRoot, 'triage', 'saved.json');
      await fs.mkdir(path.dirname(saved));
      await fs.writeFile(saved, '{"saved":"original evidence"}');
      release = async () => {
        assert.equal(await fs.readFile(saved, 'utf8'), '{"saved":"original evidence"}');
        await fs.unlink(saved); await fs.rmdir(path.dirname(saved));
      };
    }
    const preview = cli(['--all', '--dry-run']);
    assert.equal(preview.status, 1, preview.stderr);
    for (const repo of repos) assert.equal(await fs.readFile(repo.sentinel, 'utf8'), repo.bytes);
    const result = cli(['--all']);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Cleanup partial/);
    assert.equal(await fs.readFile(protectedRepo.sentinel, 'utf8'), protectedRepo.bytes);
    await assert.rejects(fs.stat(eligibleRepo.repoCacheRoot), { code: 'ENOENT' });
    await assert.rejects(cleanArtifacts({ repoPath: protectedRepo.repoRoot }), /retained-protected|Cleanup partial/);
    await assert.rejects(cleanArtifacts({ repoPath: protectedRepo.repoRoot, all: true }), /all repository caches/);
    await release(); release = async () => {};
    const final = cli(['--all']);
    assert.equal(final.status, 0, final.stderr);
    assert.match(final.stderr, /Cleanup complete/);
    await assert.rejects(fs.stat(protectedRepo.repoCacheRoot), { code: 'ENOENT' });
  }
  assert.ok((await fs.stat(path.join(cacheRoot, 'repos'))).isDirectory(), 'cleanup preserves the repository parent');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(cacheRoot, CACHE_OWNER_FILE), 'utf8')),
    { owner: 'pairofcleats', layoutVersion: 1 });
} finally {
  await release();
  assert.equal(path.dirname(temporary), temporaryParent, 'fixture cleanup stays inside its exact disposable task root');
  await rmDirRecursive(temporary);
}
console.log(`Actual multi-repository cleanup preserves ${selected} and independently removes eligible repositories.`);
