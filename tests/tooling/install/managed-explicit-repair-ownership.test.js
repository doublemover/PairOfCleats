#!/usr/bin/env node
// Authored for deferred integration. Inert archives and explicit fixture
// verifiers exercise the real publication/ownership/lifecycle consumers.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { inspectManagedInstallation, installPinnedManagedTool } from '../../../tools/tooling/managed-install.js';
import { planToolLifecycle } from '../../../tools/tooling/lifecycle.js';

const temporary = await makeTempDir('poc-explicit-managed-repair-');
try {
  await withTemporaryEnv({ PAIROFCLEATS_HOME: path.join(temporary, 'home') }, async () => {
    const toolingRoot = path.join(temporary, 'tooling');
    const archive = Buffer.from('inert approved repair fixture archive');
    const descriptor = version => ({ schemaVersion: 1, toolId: 'fixture-repair', recipeId: 'fixture-repair', version,
      platform: process.platform, arch: process.arch,
      archive: { url: `https://fixture.invalid/repair-${version}.zip`, type: 'zip', bytes: archive.length,
        sha256: createHash('sha256').update(archive).digest('hex') },
      root: 'package', command: 'fixture', args: [], requiredFiles: ['fixture'],
      storageEstimate: { complete: true, writes: [{ destination: 'artifacts', requiredBytes: 1024 * 1024 }] } });
    let downloads = 0;
    const dependencies = { approvedOrigins: ['https://fixture.invalid'],
      download: async ({ url }) => { downloads++; return { body: archive, sourceUrl: url }; },
      extract: async (_archive, target) => {
        await fs.mkdir(path.join(target, 'package'), { recursive: true });
        await fs.writeFile(path.join(target, 'package', 'fixture'), 'inert repair fixture command bytes');
      },
      verify: async ({ command, resourceId }) => ({ ok: (await fs.readFile(command, 'utf8')).startsWith('inert'),
        level: 'explicit-fixture-verifier-only', settlement: { resourceId, settled: true, pending: false } }) };
    const selected = await installPinnedManagedTool({ toolingRoot, descriptor: descriptor('1.0.0'), ...dependencies });
    assert.equal(selected.ok, true);
    const repeated = await installPinnedManagedTool({ toolingRoot, descriptor: descriptor('1.0.0'), ...dependencies });
    assert.equal(repeated.reused, true); assert.equal(downloads, 1);
    const repaired = await installPinnedManagedTool({ toolingRoot, descriptor: descriptor('1.0.0'), repair: true, ...dependencies });
    assert.equal(repaired.ok, true); assert.equal(downloads, 2, 'explicit repair does not stop at intact selected bytes');
    assert.notEqual(repaired.installId, selected.installId, 'explicit repair publishes a separate verified physical generation');
    assert.equal(await fs.readFile(selected.command, 'utf8'), 'inert repair fixture command bytes');

    const tool = { id: 'fixture-repair', install: { cache: { managedDescriptor: descriptor('2.0.0'), approvedOrigins: dependencies.approvedOrigins } },
      verifyManagedInstall: dependencies.verify };
    await fs.writeFile(repaired.command, 'drifted selected bytes');
    const drift = await inspectManagedInstallation({ toolingRoot, toolId: tool.id, descriptorId: 'f'.repeat(64) });
    assert.equal(drift.state, 'repair-required', 'requesting another recipe cannot skip selected byte inventory');
    for (const operation of ['install', 'update']) {
      const plan = await planToolLifecycle({ toolingRoot, id: tool.id, operation, tool });
      assert.equal(plan.state, 'blocked');
      assert.equal(plan.blockers.some(blocker => blocker.code === 'explicit-owned-repair-required'), true);
    }
    await assert.rejects(installPinnedManagedTool({ toolingRoot, descriptor: descriptor('2.0.0'), ...dependencies }), /explicit owned repair/);
    assert.equal(downloads, 2);
    await fs.writeFile(repaired.command, 'inert repair fixture command bytes');

    const owner = path.join(toolingRoot, 'installs', tool.id), selectorFile = path.join(owner, 'current.json');
    const selectorBytes = await fs.readFile(selectorFile);
    const receiptFile = path.join(owner, 'receipts', repaired.installId + '.json');
    const receiptBytes = await fs.readFile(receiptFile);
    const assertPreserved = async (label, alter, restore) => {
      await alter();
      const before = await fs.readFile(selectorFile);
      const inspected = await inspectManagedInstallation({ toolingRoot, toolId: tool.id, descriptorId: 'e'.repeat(64) });
      assert.equal(inspected.state, 'repair-required', label);
      assert.equal(inspected.receipt, undefined, 'unknown authority is never upgraded to owned repair permission');
      for (const repair of [false, true]) {
        await assert.rejects(installPinnedManagedTool({ toolingRoot, descriptor: descriptor('2.0.0'), repair, ...dependencies }), /ownership evidence/);
        assert.deepEqual(await fs.readFile(selectorFile), before);
      }
      const plan = await planToolLifecycle({ toolingRoot, id: tool.id, operation: 'repair', tool });
      assert.equal(plan.state, 'blocked');
      assert.equal(plan.blockers.some(blocker => blocker.code === 'managed-ownership-evidence-unavailable'), true);
      assert.equal(downloads, 2, 'unrecoverable ownership cannot acquire a replacement archive');
      await restore();
    };
    for (const patch of [value => ({ ...value, schemaVersion: 999 }), value => ({ ...value, unknownOwner: true }),
      value => ({ ...value, descriptorId: 'd'.repeat(64) })]) {
      await assertPreserved('unknown or conflicting selector authority is preserved',
        () => fs.writeFile(selectorFile, JSON.stringify(patch(JSON.parse(selectorBytes)))), () => fs.writeFile(selectorFile, selectorBytes));
    }
    await assertPreserved('selected missing receipt is evidence damage, not an absent installation',
      () => fs.unlink(receiptFile), () => fs.writeFile(receiptFile, receiptBytes));
    await assertPreserved('unknown receipt schema cannot be bypassed by another desired version',
      () => fs.writeFile(receiptFile, JSON.stringify({ ...JSON.parse(receiptBytes), schemaVersion: 999 })),
      () => fs.writeFile(receiptFile, receiptBytes));
    assert.equal((await inspectManagedInstallation({ toolingRoot, toolId: tool.id })).ok, true);
  });
} finally { await rmDirRecursive(temporary); }
console.log('Explicit repair replaces intact selected generations; unknown selector/receipt authority is preserved across desired versions.');
