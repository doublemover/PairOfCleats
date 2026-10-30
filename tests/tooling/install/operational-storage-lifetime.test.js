#!/usr/bin/env node
// Authored integration fixture. All commands explicitly select inert trusted
// files; actual shared storage owners are used without running vendor tools.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { repoAccessPaths } from '../../../src/shared/cache/repo-access.js';
import { withOperationalTool } from '../../../tools/tooling/operational-execution.js';

const temporary = await makeTempDir('poc-operational-storage-'), remove = fsSync.rmSync;
try {
  const repoRoot = path.join(temporary, 'repo'), home = path.join(temporary, 'home'), toolingRoot = path.join(temporary, 'tools');
  await fs.mkdir(repoRoot);
  const command = path.join(repoRoot, 'explicit-trusted-operational-fixture');
  await fs.writeFile(command, 'inert selected fixture bytes');
  const coordinationRoot = path.join(home, 'state', 'storage-access');
  await withTemporaryEnv({ PAIROFCLEATS_HOME: home, PAIROFCLEATS_TRUSTED_REPOS: JSON.stringify([repoRoot]),
    PAIROFCLEATS_TRUSTED_CONFIG: null, TMPDIR: null, TMP: null, TEMP: null }, async () => {
    let releases = 0, consumerScratch = null;
    const tool = { id: 'ripgrep', detect: { cmd: command }, authorityRepoRoot: repoRoot, toolingRoot, prerequisites: [],
      managedInstallation: { descriptorId: 'b'.repeat(64), installId: 'a'.repeat(64) } };
    const dependencies = { getConfig: () => ({ dir: toolingRoot }), resolveTools: () => [tool],
      retain: async () => ({ command, args: [], receipt: { installId: 'a'.repeat(64) }, release: () => { releases++; return true; } }),
      spawn: async (selected, args, options) => {
        assert.equal(selected, command);
        assert.equal(options.env.RUSTUP_AUTO_INSTALL, '0');
        const scratch = options.env.TMP;
        assert.ok(scratch.startsWith(path.join(home, 'tmp', 'managed-children') + path.sep));
        assert.equal(options.env.TEMP, scratch); assert.equal(options.env.TMPDIR, scratch);
        assert.equal((await inspectStorageAccess(scratch, { coordinationRoot })).protected, true,
          'real cache/scratch lease exists before any child operation');
        assert.equal(JSON.parse(await fs.readFile(path.join(scratch, '.pairofcleats-child-owner.json'), 'utf8')).toolId, 'ripgrep');
        if (args[0] === '--version') return { exitCode: 0, stdout: 'ripgrep 15.2.0' };
        if (args[0] === '--json') return { exitCode: 0, stdout: JSON.stringify({ type: 'match', data: { lines: { text: 'pairofcleats-rg-probe\n' } } }) };
        consumerScratch = scratch;
        await fs.writeFile(path.join(scratch, 'actual-fixture-child-write'), 'retained evidence');
        return { exitCode: 0, stdout: 'fixture.js\n' };
      } };
    await withOperationalTool('ripgrep', { repoRoot }, selected => selected.run(['--files']), dependencies);
    assert.equal(releases, 1);
    assert.equal((await inspectStorageAccess(consumerScratch, { coordinationRoot })).protected, false);
    assert.equal(await fs.readFile(path.join(consumerScratch, 'actual-fixture-child-write'), 'utf8'), 'retained evidence',
      'settlement removes ownership metadata without deleting unqualified scratch evidence');

    let settled = false, pendingScratch = null;
    let pendingFailure;
    try {
      await withOperationalTool('ripgrep', { repoRoot }, selected => selected.stream(async options => {
        pendingScratch = options.env.TMP; options.onSpawn();
        options.onSettlement({ closeObserved: false, treeCleanupSettled: false, treeCleanupFailed: false, isSettled: () => settled });
        throw Object.freeze(new Error('fixture streaming child still owns its writes'));
      }, ['--files'], { cwd: repoRoot }), dependencies);
    } catch (error) { pendingFailure = error; }
    assert.equal(pendingFailure.cacheOwnershipReleased(), false);
    assert.equal(releases, 1, 'pending stream keeps the exact managed installation');
    assert.equal((await inspectStorageAccess(pendingScratch, { coordinationRoot })).protected, true);
    const pendingSession = pendingFailure.managedInstallSession;
    assert.throws(() => pendingSession.releaseAfterSettlement({ resourceId: pendingSession.resourceId, settled: true, pending: false }), /pending/);
    assert.equal((await inspectStorageAccess(pendingScratch, { coordinationRoot })).protected, true);
    settled = true;
    assert.equal(pendingSession.releaseAfterSettlement({ resourceId: pendingSession.resourceId, settled: true, pending: false }), true);
    assert.equal(pendingFailure.cacheOwnershipReleased(), true);
    assert.equal(releases, 2);
    assert.equal((await inspectStorageAccess(pendingScratch, { coordinationRoot })).protected, false);

    let denyMetadata = true, metadataScratch = null;
    const metadataError = Object.freeze(Object.assign(new Error('exact fixture cache metadata release denied'), { code: 'EACCES' }));
    fsSync.rmSync = (target, ...args) => {
      if (denyMetadata && metadataScratch && path.dirname(target) === repoAccessPaths(metadataScratch, { coordinationRoot }).leases) throw metadataError;
      return remove(target, ...args);
    };
    let metadataFailure;
    try {
      await withOperationalTool('ripgrep', { repoRoot }, selected => selected.run(['--files']), { ...dependencies,
        spawn: async (selected, args, options) => {
          if (args[0] === '--files') metadataScratch = options.env.TMP;
          return dependencies.spawn(selected, args, options);
        } });
    } catch (error) { metadataFailure = error; }
    assert.equal(metadataFailure.cacheOwnershipReleased(), false);
    assert.equal(releases, 2, 'closed child still retains installation until its cache lease metadata releases');
    assert.equal((await inspectStorageAccess(metadataScratch, { coordinationRoot })).protected, true);
    const metadataSession = metadataFailure.managedInstallSession;
    assert.throws(() => metadataSession.releaseAfterSettlement({ resourceId: metadataSession.resourceId, settled: true, pending: false }));
    denyMetadata = false;
    assert.equal(metadataSession.releaseAfterSettlement({ resourceId: metadataSession.resourceId, settled: true, pending: false }), true);
    assert.equal(releases, 3);
    assert.equal(metadataFailure.cacheOwnershipReleased(), true);
    assert.equal((await inspectStorageAccess(metadataScratch, { coordinationRoot })).protected, false);
  });
} finally { fsSync.rmSync = remove; await rmDirRecursive(temporary); }
console.log('Operational commands retain canonical child storage and exact generations until actual stream and cache metadata settlement.');
