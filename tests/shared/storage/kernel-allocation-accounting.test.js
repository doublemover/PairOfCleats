import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { inspectStorageInventory } from '../../../src/shared/storage/inventory.js';
import * as allocationOwner from '../../../src/shared/storage/inventory.js';
import { planCacheRootCleanup, applyStorageCleanupPlan } from '../../../src/shared/storage/cleanup.js';
import { writePersistentCommandProbeCache } from '../../../src/index/tooling/command-probe-persistent-cache.js';
import { CACHE_OWNER_FILE } from '../../../src/shared/cache-deletion.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { assertNoSymlinkPath } from '../../../src/shared/contained-file.js';
import { ensureTestingEnv, withTemporaryEnv } from '../../helpers/test-env.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('shared/storage/kernel-allocation-accounting/')[1];
const scope = path.resolve('.tmp/tasks/kernel-allocation-fixture'); await fs.mkdir(scope, { recursive: true });
const root = await fs.mkdtemp(path.join(scope, 'case-')), marker = randomUUID(); await fs.writeFile(path.join(root, '.owned-fixture'), marker);
const originalStat = fs.lstat;
const { storageAllocatedBytes } = allocationOwner;
const measured = stat => Number(stat.blocks * 512n);
try {
  await withTemporaryEnv(ensureTestingEnv({ PAIROFCLEATS_HOME: path.join(root, 'home'), PAIROFCLEATS_TRUSTED_CONFIG: null }), async () => {
    if (mode === 'exact-block-domain') {
      for (const blocks of [0, 1, 17, 0n, 1n, 17n]) assert.equal(storageAllocatedBytes({ blocks, size: 9999999 }), Number(blocks) * 512);
      for (const blocks of [undefined, null, false, '1', -1, -1n, 1.5, NaN, Infinity,
        Number.MAX_SAFE_INTEGER + 1, BigInt(Number.MAX_SAFE_INTEGER)]) assert.equal(storageAllocatedBytes({ blocks, size: 0 }), null);
      const boundary = BigInt(Number.MAX_SAFE_INTEGER) / 512n;
      assert.equal(storageAllocatedBytes({ blocks: boundary }), Number(boundary * 512n));
      assert.equal(storageAllocatedBytes({ blocks: boundary + 1n }), null);
      const original = new Error('original allocation observer failure');
      assert.throws(() => storageAllocatedBytes({ get blocks() { throw original; } }), error => error === original); return;
    }
    const dataRoot = path.join(root, 'data'); await fs.mkdir(dataRoot);
    const file = path.join(dataRoot, 'source.bin'); await fs.writeFile(file, randomBytes(8193));
    if (mode === 'unique-observed-allocation') {
      const stat = await originalStat(file, { bigint: true }), expected = measured(stat);
      const inventory = await inspectStorageInventory({ roots: [{ id: 'parent', path: dataRoot }, { id: 'same-file', path: file }], includeFiles: true });
      assert.equal(inventory.complete, true); assert.equal(inventory.totals.uniqueFiles, 1);
      assert.equal(inventory.totals.uniqueLogicalBytes, 8193); assert.equal(inventory.totals.logicalAttributedBytes, 16386);
      assert.equal(inventory.totals.uniqueAllocatedBytes, expected);
      assert.deepEqual(inventory.items.map(item => item.allocatedBytes), [expected, expected]);
      assert.equal(inventory.totals.reclaimableBytes, null, 'kernel allocation grants no deletion/reclaim authority'); return;
    }
    if (mode === 'conflicting-alias-allocation') {
      let fileStats = 0;
      fs.lstat = async (...args) => {
        const value = await originalStat(...args);
        if (path.resolve(args[0]) !== file) return value;
        if (++fileStats < 3) return value;
        return Object.assign(Object.create(Object.getPrototypeOf(value)), value, { blocks: value.blocks + 8n });
      };
      const inventory = await inspectStorageInventory({ roots: [{ id: 'first', path: file }, { id: 'second', path: file }], includeFiles: true });
      assert.equal(inventory.complete, false); assert.equal(inventory.totals.uniqueAllocatedBytes, null);
      assert.ok(inventory.errors.some(error => error.code === 'ERR_STORAGE_SCAN_CHANGED')); return;
    }
    if (mode === 'reviewed-probe-unlink-estimate') {
      const cache = path.join(root, 'cache'), toolingCache = path.join(cache, 'tooling');
      await fs.mkdir(toolingCache, { recursive: true });
      await fs.writeFile(path.join(cache, CACHE_OWNER_FILE), JSON.stringify({ owner: 'pairofcleats', layoutVersion: 1 }));
      assert.equal(writePersistentCommandProbeCache({ providerId: 'allocation-fixture', command: process.execPath,
        args: ['--version'], cwd: root, probeEnv: {}, toolingConfig: { cache: { dir: toolingCache } }, attempted: [{ ok: true }] }), true);
      const probes = path.join(toolingCache, 'command-probes'), names = (await fs.readdir(probes)).filter(name => /^[a-f0-9]{40}\.json$/u.test(name));
      assert.equal(names.length, 1);
      const expected = measured(await originalStat(path.join(probes, names[0]), { bigint: true }));
      const plan = await planCacheRootCleanup({ cacheRoot: cache, authorityRoots: [cache] });
      assert.equal(plan.applyReady, true); assert.equal(plan.operations.length, 1); assert.equal(plan.estimatedReclaimBytes, expected);
      const result = await applyStorageCleanupPlan(plan, { authorityRoots: [cache], approvedPlanId: plan.planId });
      assert.equal(result.complete, true); assert.equal(result.estimatedReclaimedBytes, expected);
      assert.equal(result.actualReclaimedBytes, null, 'an unlink/allocation observation is not a free-space measurement');
      assert.deepEqual(await fs.readdir(probes), []); return;
    }
    if (mode === 'sparse-or-compressed-allocation') {
      let before = null;
      if (process.platform === 'win32') {
        const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT;
        assert.ok(path.win32.isAbsolute(systemRoot || ''), 'the original Windows launch must select its system utilities');
        await fs.writeFile(file, Buffer.alloc(4 * 1024 * 1024, 97));
        before = await originalStat(file, { bigint: true });
        const compact = await spawnSubprocess(path.win32.join(systemRoot, 'System32', 'compact.exe'), ['/C', '/F', '/Q', file],
          { cwd: root, timeoutMs: 5000, maxOutputBytes: 65536, stdio: 'pipe', rejectOnNonZeroExit: false });
        assert.equal(compact.exitCode, 0, compact.stderr || compact.stdout);
      } else {
        const handle = await fs.open(file, 'w');
        try { await handle.truncate(4 * 1024 * 1024); } finally { await handle.close(); }
      }
      const after = await originalStat(file, { bigint: true });
      if (before) { assert.equal(after.size, before.size); assert.ok(after.blocks < before.blocks, 'this Windows fixture requires actual filesystem compression'); }
      const inventory = await inspectStorageInventory({ roots: [{ id: 'compressed', path: dataRoot }], includeFiles: true });
      assert.equal(inventory.complete, true); assert.equal(inventory.totals.uniqueAllocatedBytes, measured(after));
      assert.ok(inventory.totals.uniqueAllocatedBytes < inventory.totals.uniqueLogicalBytes);
      console.log(JSON.stringify({ node: process.version, uv: process.versions.uv, platform: process.platform,
        source: before ? 'Windows compressed file' : 'POSIX sparse file', logicalBytes: String(after.size),
        beforeBlocks: before ? String(before.blocks) : null, allocatedBlocks: String(after.blocks) })); return;
    }
    throw new Error('Unknown kernel allocation case: ' + mode);
  });
} finally {
  fs.lstat = originalStat;
  assertNoSymlinkPath(path.parse(root).root, root);
  const physical = await fs.realpath(root); assert.equal(path.dirname(physical), await fs.realpath(scope));
  assert.equal(await fs.readFile(path.join(physical, '.owned-fixture'), 'utf8'), marker); await fs.rm(physical, { recursive: true });
}
console.log('Kernel allocation accounting case passed: ' + mode);
