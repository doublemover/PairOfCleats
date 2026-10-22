import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';
import { retainRepoCacheAccess, prepareRepoCacheAccessHandoff, cancelRepoCacheAccessHandoff,
  repoAccessPaths, withExclusiveRepoCacheCleanup } from '../../../src/shared/cache/repo-access.js';
import { startDelegatedRepoCacheOwner } from '../../../src/shared/cache/repo-access-delegation.js';
import { inspectRepoCacheDelegation } from '../../../src/shared/cache/repo-access-delegation-guard.js';

const temporary = await makeTempDir('poc-storage-delegated-native-');
const env = applyTestEnv({ syncProcess: false });
delete env.NODE_OPTIONS;
try {
  const entry = path.resolve('tests/fixtures/storage/delegated-native-owner.js');
  const coordinationRoot = path.join(temporary, 'state', 'access');
  for (const forged of ['wrong-child', 'stale-startup-nonce']) {
    const root = path.join(temporary, forged);
    await fs.mkdir(root);
    const preload = fileURLToPath(new URL('../../../src/shared/cache/repo-access-delegation-preload.js', import.meta.url));
    const rogue = spawn(process.execPath, ['--import', preload, entry, 'settled', root, coordinationRoot], {
      env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });
    rogue.stdout.resume(); rogue.stderr.resume();
    rogue.once('message', hello => rogue.send({ protocol: 'pairofcleats-cache-delegation-v1', type: 'grant', capability: '0'.repeat(64),
      record: { protocol: 'pairofcleats-cache-delegation-v1', schemaVersion: 1, phase: 'issued',
        parentPid: process.pid, childPid: forged === 'wrong-child' ? rogue.pid + 1 : rogue.pid,
        childNonce: forged === 'wrong-child' ? hello.nonce : '0'.repeat(64) } }));
    const code = await new Promise((resolve, reject) => { rogue.once('close', resolve); rogue.once('error', reject); });
    assert.notEqual(code, 0, 'serialized wrong-child/stale grant cannot admit the entry');
    assert.deepEqual(await fs.readdir(root), [], 'native command must not import or open a database before admission');
  }
  for (const mode of ['settled', 'no-settlement', 'forged-receipt', 'failed-settlement-send']) {
    const root = path.join(temporary, mode);
    await fs.mkdir(root);
    retainRepoCacheAccess(root, { coordinationRoot });
    const handoff = await prepareRepoCacheAccessHandoff(root, { coordinationRoot,
      drain: async ({ leaseId }) => ({ leaseId, drained: true, pending: false }) });
    if (mode === 'settled') {
      await assert.rejects(startDelegatedRepoCacheOwner(root, { localAccessHandoff: { ...handoff }, resourceId: 'fixture-native',
        commandIdentity: 'fixture-sqlite-create', entry, args: [mode, root, coordinationRoot], coordinationRoot, env }), /Invalid or stale/);
      assert.equal(cancelRepoCacheAccessHandoff(handoff), true);
    }
    const actual = mode === 'settled' ? await prepareRepoCacheAccessHandoff(root, { coordinationRoot,
      drain: async ({ leaseId }) => ({ leaseId, drained: true, pending: false }) }) : handoff;
    const controller = await startDelegatedRepoCacheOwner(root, { localAccessHandoff: actual, resourceId: 'fixture-native',
      commandIdentity: 'fixture-sqlite-create', entry, args: [mode, root, coordinationRoot], coordinationRoot, env });
    let childProof = '';
    controller.child.stdout?.on('data', bytes => { childProof += bytes.toString('utf8'); });
    controller.child.stderr?.resume();
    if (mode === 'settled') {
      const result = await controller.completion;
      assert.equal(result.result.settled, true);
      assert.equal(controller.child.exitCode, 0);
      assert.match(childProof, /actual settlement transmission controls passed/);
      assert.equal(inspectRepoCacheDelegation(repoAccessPaths(root, { coordinationRoot })).protected, false);
      retainRepoCacheAccess(root, { coordinationRoot });
      assert.equal((await fs.readdir(repoAccessPaths(root, { coordinationRoot }).leases)).length, 1, 'exact parent lease restored before exclusion release');
    } else {
      await assert.rejects(controller.completion, { code: 'ERR_REPO_CACHE_DELEGATION_PENDING' });
      if (mode === 'failed-settlement-send') {
        assert.equal(controller.child.exitCode, 0, 'expected pending ownership cannot mask failed child assertions');
        assert.match(childProof, /original settlement send failure controls passed/);
      }
      const paths = repoAccessPaths(root, { coordinationRoot });
      const record = JSON.parse(await fs.readFile(path.join(paths.directory, 'delegation.json'), 'utf8'));
      assert.equal(record.parentLeaseId, actual.leaseId);
      assert.equal(record.childPid, controller.child.pid);
      assert.equal((await fs.readdir(paths.leases)).some(file => file === `${actual.leaseId}.json`), true,
        'pending failure restores the retained parent reader while keeping it suspended');
      assert.throws(() => retainRepoCacheAccess(root, { coordinationRoot }), { code: 'ERR_REPO_CACHE_ACCESS_SUSPENDED' });
      assert.equal((await withExclusiveRepoCacheCleanup(root, () => assert.fail('pending delegation cannot collect'), { coordinationRoot })).protected, true);
      // Simulate an obsolete parent PID in cleanup.lock. Ordinary admission
      // must still preserve it because the unresolved delegation is authority.
      const lockBefore = await fs.readFile(paths.lockPath, 'utf8');
      const lock = JSON.parse(lockBefore);
      await fs.writeFile(paths.lockPath, JSON.stringify({ ...lock, pid: 2147483647 }));
      const unchanged = await fs.readFile(paths.lockPath, 'utf8');
      const probe = runNode(['tests/fixtures/storage/delegated-reader-probe.js', root, coordinationRoot],
        'delegated stale-parent reader guard', process.cwd(), env, { stdio: 'pipe', allowFailure: true, timeoutMs: 10000 });
      assert.equal(probe.status, 0, probe.stderr || probe.stdout);
      assert.equal(await fs.readFile(paths.lockPath, 'utf8'), unchanged, 'reader cannot reap stale parent while delegation remains unresolved');
      assert.equal(await fs.readFile(path.join(root, 'fixture.sqlite')).then(bytes => bytes.length > 0), true);
    }
  }
} finally { await rmDirRecursive(temporary); }
console.log('delegated native owner lifetime passed');
