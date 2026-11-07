#!/usr/bin/env node
// Authored actual managed publication/reuse fixture. The archive and every
// command are explicitly trusted inert fixtures; no vendor executable runs.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { installPinnedManagedTool, inspectManagedInstallation, inspectManagedToolRemoval } from '../../../tools/tooling/managed-install.js';
import { verifyManagedOperationalTool } from '../../../tools/tooling/operational-probes.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';

const temporary = await makeTempDir('poc-managed-operational-probe-');
try {
  const home = path.join(temporary, 'home'), toolingRoot = path.join(temporary, 'tools');
  const coordinationRoot = path.join(home, 'state', 'storage-access');
  await withTemporaryEnv({ PAIROFCLEATS_HOME: home, TMP: null, TEMP: null, TMPDIR: null }, async () => {
    const archive = Buffer.from('inert explicitly trusted operational recipe archive');
    const descriptor = version => ({ schemaVersion: 1, toolId: 'ripgrep', recipeId: 'explicit-trusted-native-fixture', version,
      platform: process.platform, arch: process.arch, command: 'explicit-trusted-ripgrep-fixture', args: [],
      requiredFiles: ['explicit-trusted-ripgrep-fixture'], archive: { url: `https://fixture.invalid/rg-${version}.zip`, type: 'zip',
        bytes: archive.length, sha256: createHash('sha256').update(archive).digest('hex') },
      storageEstimate: { complete: true, writes: [{ destination: 'artifacts', requiredBytes: 1024 * 1024 }] } });
    let downloads = 0, pendingNext = false, childSettled = false, pendingScratch, currentVersion;
    const pending = Object.freeze(Object.assign(new Error('exact fixture capability child close pending'), {
      cacheOwnershipPending: true, cacheOwnershipReleased() { assert.equal(this, pending); return childSettled; }
    }));
    const dependencies = { approvedOrigins: ['https://fixture.invalid'],
      download: async ({ url }) => { downloads++; return { body: archive, sourceUrl: url }; },
      extract: async (_archive, target) => {
        await fs.mkdir(target, { recursive: true });
        await fs.writeFile(path.join(target, 'explicit-trusted-ripgrep-fixture'), 'inert selected native command bytes');
      },
      verify: async input => {
        assert.equal(input.toolingRoot, toolingRoot, 'publication passes its launch-selected storage owner to the canonical verifier');
        currentVersion = input.descriptor.version;
        return verifyManagedOperationalTool(input, { probe: async (command, args, options) => {
          assert.equal(command, input.command, 'the verifier executes only its selected staged/retained fixture');
          assert.equal(options.env.RUSTUP_AUTO_INSTALL, '0');
          assert.equal((await inspectStorageAccess(options.env.TMP, { coordinationRoot })).protected, true);
          assert.equal((await fs.stat(path.join(options.env.TMP, '.pairofcleats-child-owner.json'))).isFile(), true);
          if (pendingNext) { pendingNext = false; pendingScratch = options.env.TMP; throw pending; }
          if (args[0] === '--version') return { ok: true, stdout: 'ripgrep ' + currentVersion };
          return { ok: true, stdout: JSON.stringify({ type: 'match', data: { lines: { text: 'pairofcleats-rg-probe\n' } } }) };
        } });
      } };
    const first = await installPinnedManagedTool({ toolingRoot, descriptor: descriptor('15.2.0'), ...dependencies });
    assert.equal(first.ok, true);
    assert.equal((await installPinnedManagedTool({ toolingRoot, descriptor: descriptor('15.2.0'), ...dependencies })).reused, true);
    assert.equal(downloads, 1);

    for (const [version, fresh] of [['15.2.0', false], ['15.2.1', true]]) {
      pendingNext = true; childSettled = false;
      let failure;
      try { await installPinnedManagedTool({ toolingRoot, descriptor: descriptor(version), ...dependencies }); }
      catch (error) { failure = error; }
      assert.equal(failure.cacheOwnershipReleased(), false);
      assert.equal((await inspectStorageAccess(pendingScratch, { coordinationRoot })).protected, true);
      assert.equal((await inspectManagedInstallation({ toolingRoot, toolId: 'ripgrep' })).command, first.command);
      assert.equal((await inspectManagedToolRemoval({ toolingRoot, toolId: 'ripgrep' })).state, 'blocked');
      const session = failure.managedInstallSession, receipt = { resourceId: session.resourceId, settled: true, pending: false };
      if (fresh) await assert.rejects(session.releaseAfterSettlement(receipt), /pending/);
      else assert.throws(() => session.releaseAfterSettlement(receipt), /pending/);
      childSettled = true;
      assert.equal(await session.releaseAfterSettlement(receipt), true);
      assert.equal(failure.cacheOwnershipReleased(), true);
      assert.equal((await inspectStorageAccess(pendingScratch, { coordinationRoot })).protected, false);
      assert.equal((await inspectManagedInstallation({ toolingRoot, toolId: 'ripgrep' })).command, first.command);
      assert.equal((await inspectManagedToolRemoval({ toolingRoot, toolId: 'ripgrep' })).state, 'owned-and-idle');
    }
    assert.equal(downloads, 2, 'failed fresh update acquires one archive; reuse probes acquire none');
  });
} finally { await rmDirRecursive(temporary); }
console.log('Managed operational install, retained reuse and failed update preserve actual probe storage through exact recovery.');
