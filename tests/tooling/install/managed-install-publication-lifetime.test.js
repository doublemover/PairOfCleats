#!/usr/bin/env node
// Source regression authored for the development batch; UNVALIDATED.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { installPinnedManagedTool, inspectManagedInstallation, retainManagedToolInstallation, inspectManagedToolRemoval, removePinnedManagedTool } from '../../../tools/tooling/managed-install.js';
import { resolveManagedToolInstallation } from '../../../src/shared/managed-installation.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';

const suite = path.join(process.cwd(), '.tmp', 'tasks', 'managed-install-publication-lifetime');
await fs.mkdir(suite, { recursive: true });
const root = await fs.mkdtemp(path.join(suite, 'case-'));
try {
  await withTemporaryEnv({ PAIROFCLEATS_HOME: path.join(root, 'home') }, async () => {
    const toolingRoot = path.join(root, 'tools');
    const archive = Buffer.from('inert approved archive fixture');
    const checksum = createHash('sha256').update(archive).digest('hex');
    let downloads = 0;
    const descriptor = version => ({ schemaVersion: 1, toolId: 'fixture-tool', recipeId: 'fixture-archive', version,
      platform: process.platform, arch: process.arch, archive: { url: `https://official.example.test/tool-${version}.zip`, type: 'zip', bytes: archive.length, sha256: checksum },
      storageEstimate: { complete: true, writes: [{ destination: 'artifacts', requiredBytes: 1024 * 1024 }] },
      root: 'package', command: 'bin/tool', args: [], requiredFiles: ['bin/tool', 'lib/data'] });
    const dependencies = {
      approvedOrigins: ['https://official.example.test'],
      download: async ({ url }) => { downloads++; return { body: archive, sourceUrl: url }; },
      extract: async (_archive, destination) => {
        await fs.mkdir(path.join(destination, 'package', 'bin'), { recursive: true });
        await fs.mkdir(path.join(destination, 'package', 'lib'));
        await fs.writeFile(path.join(destination, 'package', 'bin', 'tool'), 'fixture executable bytes');
        await fs.writeFile(path.join(destination, 'package', 'lib', 'data'), 'fixture runtime library');
      },
      verify: async ({ command, resourceId }) => ({ ok: (await fs.readFile(command, 'utf8')).includes('fixture'), level: 'fixture-only', settlement: { resourceId, settled: true, pending: false } })
    };
    const first = await installPinnedManagedTool({ toolingRoot, descriptor: descriptor('1.0.0'), ...dependencies });
    assert.equal(first.ok, true);
    assert.equal(resolveManagedToolInstallation(toolingRoot, 'fixture-tool').command, first.command);
    await installPinnedManagedTool({ toolingRoot, descriptor: descriptor('1.0.0'), ...dependencies });
    assert.equal(downloads, 1, 'compatible existing managed generation performs zero downloads');
    let pendingVerification;
    await assert.rejects(installPinnedManagedTool({ toolingRoot, descriptor: descriptor('1.0.0'), ...dependencies,
      verify: async () => { throw new Error('fixture verifier failed without settlement'); } }), error => {
      pendingVerification = error;
      return error.cacheOwnershipPending === true;
    });
    assert.equal((await inspectManagedToolRemoval({ toolingRoot, toolId: 'fixture-tool' })).state, 'blocked', 'failed verifier without settlement retains consumer ownership');
    const pendingSession = pendingVerification.managedInstallSession;
    assert.throws(() => pendingSession.releaseAfterSettlement({ resourceId: 'another-resource', settled: true }), /remains pending/);
    assert.equal(pendingSession.releaseAfterSettlement({ resourceId: pendingSession.resourceId, settled: true, pending: false }), true);
    const held = await retainManagedToolInstallation({ toolingRoot, toolId: 'fixture-tool' });
    const blocked = await installPinnedManagedTool({ toolingRoot, descriptor: descriptor('2.0.0'), ...dependencies });
    assert.equal(blocked.state, 'verified-awaiting-owner-release');
    assert.equal((await inspectManagedInstallation({ toolingRoot, toolId: 'fixture-tool' })).command, first.command);
    assert.equal(held.release(), true);
    const resumed = await installPinnedManagedTool({ toolingRoot, descriptor: descriptor('2.0.0'), ...dependencies });
    assert.equal(resumed.ok, true);
    assert.equal(downloads, 2, 'resuming verified sibling does not reacquire archive');
    await fs.writeFile(resumed.command, 'damaged selected installation bytes');
    const drift = await inspectManagedInstallation({ toolingRoot, toolId: 'fixture-tool' });
    assert.equal(drift.state, 'repair-required');
    assert.equal(resolveManagedToolInstallation(toolingRoot, 'fixture-tool'), null, 'drift cannot be selected by consumers');
    await assert.rejects(installPinnedManagedTool({ toolingRoot, descriptor: descriptor('2.0.0'), ...dependencies }), /explicit owned repair/);
    assert.equal(downloads, 2, 'ordinary install preserves drift without downloading over it');
    const repaired = await installPinnedManagedTool({ toolingRoot, descriptor: descriptor('2.0.0'), repair: true, ...dependencies });
    assert.equal(repaired.ok, true);
    assert.equal(repaired.receipt.descriptorId, resumed.receipt.descriptorId, 'repair retains the exact pinned recipe identity');
    assert.notEqual(repaired.receipt.installId, resumed.receipt.installId, 'repair creates a distinct immutable physical generation');
    assert.equal(await fs.readFile(resumed.command, 'utf8'), 'damaged selected installation bytes', 'damaged evidence survives repair');
    assert.equal(downloads, 3);
    const failed = descriptor('3.0.0');
    await assert.rejects(installPinnedManagedTool({ toolingRoot, descriptor: failed, ...dependencies,
      verify: async ({ resourceId }) => ({ ok: false, settlement: { resourceId, settled: true, pending: false } }) }), /verification failed/);
    assert.equal((await inspectManagedInstallation({ toolingRoot, toolId: 'fixture-tool' })).command, repaired.command);
    const removal = await inspectManagedToolRemoval({ toolingRoot, toolId: 'fixture-tool' });
    assert.equal(removal.state, 'owned-and-idle');
    assert.equal((await removePinnedManagedTool(removal)).ok, true);
    await assert.rejects(fs.stat(repaired.root), { code: 'ENOENT' });
    assert.equal((await fs.stat(resumed.root)).isDirectory(), true, 'repair evidence survives selected generation removal');
    assert.equal((await fs.stat(first.root)).isDirectory(), true, 'prior retained generation survives selected removal');
  });
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Pinned managed installs preserve prior versions, leases and failed-update evidence.');
