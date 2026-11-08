#!/usr/bin/env node
// UNRUN source regression. Actual publication/admission and persisted readers
// consume explicitly selected inert archive/npm-tarball fixtures only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { isKnownManagedInstallationArchive, isKnownManagedInstallationDescriptor, isKnownManagedInstallationReceipt } from '../../../src/shared/managed-installation-contract.js';
import { resolveManagedToolInstallation, inspectManagedInstallationSync, retainManagedToolInstallationSync } from '../../../src/shared/managed-installation.js';
import { installPinnedManagedTool, inspectManagedInstallation, validatePinnedInstallDescriptor } from '../../../tools/tooling/managed-install.js';

const temporary = await makeTempDir('poc-managed-digest-authority-');
try {
  await withTemporaryEnv({ PAIROFCLEATS_HOME: path.join(temporary, 'home') }, async () => {
    const toolingRoot = path.join(temporary, 'tooling'), body = Buffer.from('explicitly approved immutable fixture bytes');
    let downloads = 0, extractions = 0;
    const dependencies = { approvedOrigins: ['https://fixture.invalid', 'https://registry.npmjs.org'],
      download: async ({ url }) => { downloads++; return { body, sourceUrl: url }; },
      extract: async (_archive, target) => { extractions++; await fs.mkdir(target, { recursive: true }); await fs.writeFile(path.join(target, 'fixture'), 'inert consumer bytes'); },
      verify: async ({ resourceId }) => ({ ok: true, level: 'explicit-fixture-only', settlement: { resourceId, settled: true, pending: false } }) };
    const descriptor = (id, algorithm, type = 'zip', version = '1.0.0') => ({ schemaVersion: 1, toolId: id, recipeId: 'fixture-immutable-archive', version,
      platform: process.platform, arch: process.arch, archive: { url: type === 'tar.gz'
        ? `https://registry.npmjs.org/fixture/-/fixture-${version}.tgz` : `https://fixture.invalid/archive-${version}.zip`,
      type, bytes: body.length, [algorithm]: createHash(algorithm).update(body).digest('hex') },
      command: 'fixture', args: [], requiredFiles: ['fixture'], storageEstimate: { complete: true, writes: [{ destination: 'artifacts', requiredBytes: 1024 * 1024 }] } });
    for (const [id, algorithm, type] of [['fixture-sha256', 'sha256', 'zip'], ['fixture-dotnet-sha512', 'sha512', 'zip'], ['fixture-npm-sha512', 'sha512', 'tar.gz']]) {
      const selected = descriptor(id, algorithm, type);
      if (type === 'tar.gz') {
        const npmIntegrity = 'sha512-' + createHash('sha512').update(body).digest('base64');
        assert.equal(Buffer.from(npmIntegrity.slice('sha512-'.length), 'base64').toString('hex'), selected.archive.sha512);
      }
      assert.equal(isKnownManagedInstallationArchive(selected.archive), true);
      const first = await installPinnedManagedTool({ toolingRoot, descriptor: selected, ...dependencies });
      assert.equal(first.ok, true); assert.equal(isKnownManagedInstallationReceipt(first.receipt), true);
      assert.equal(first.receipt.source[algorithm], selected.archive[algorithm]);
      assert.match(first.receipt.files[0].sha256, /^[a-f0-9]{64}$/, 'file/executable identity remains canonical SHA256 independently of archive algorithm');
      assert.equal(resolveManagedToolInstallation(toolingRoot, id).installId, first.installId);
      assert.equal(inspectManagedInstallationSync({ toolingRoot, toolId: id }).ok, true);
      const held = retainManagedToolInstallationSync({ toolingRoot, toolId: id }); assert.equal(held.release(), true);
      const beforeDownloads = downloads;
      assert.equal((await installPinnedManagedTool({ toolingRoot, descriptor: selected, ...dependencies })).reused, true);
      assert.equal(downloads, beforeDownloads);
      const receiptFile = path.join(toolingRoot, 'installs', id, 'receipts', first.installId + '.json');
      const bytes = await fs.readFile(receiptFile);
      for (const change of [receipt => ({ ...receipt, source: { ...receipt.source, [algorithm === 'sha512' ? 'sha256' : 'sha512']: '0'.repeat(algorithm === 'sha512' ? 64 : 128) } }),
        receipt => ({ ...receipt, source: { ...receipt.source, [algorithm]: '0'.repeat(algorithm === 'sha512' ? 128 : 64) } })]) {
        const changed = change(JSON.parse(bytes)); await fs.writeFile(receiptFile, JSON.stringify(changed));
        assert.equal(isKnownManagedInstallationReceipt(changed), false);
        assert.equal(resolveManagedToolInstallation(toolingRoot, id), null);
        assert.equal(inspectManagedInstallationSync({ toolingRoot, toolId: id }).state, 'repair-required');
        assert.equal((await inspectManagedInstallation({ toolingRoot, toolId: id })).state, 'repair-required');
        await assert.rejects(installPinnedManagedTool({ toolingRoot, descriptor: selected, repair: true, ...dependencies }), /ownership evidence/);
        assert.equal(downloads, beforeDownloads);
      }
      await fs.writeFile(receiptFile, bytes);
      const wrong = descriptor(id, algorithm, type, '1.0.1'); wrong.archive[algorithm] = '0'.repeat(algorithm === 'sha512' ? 128 : 64);
      const beforeExtractions = extractions;
      await assert.rejects(installPinnedManagedTool({ toolingRoot, descriptor: wrong, ...dependencies }), /immutable digest mismatch/);
      assert.equal(extractions, beforeExtractions, 'unverified bytes cannot enter archive extraction');
      assert.equal(resolveManagedToolInstallation(toolingRoot, id).installId, first.installId, 'wrong checksum cannot replace the working generation');
    }
    const source = descriptor('fixture-invalid', 'sha256');
    const invalid = [{ ...source.archive, sha512: 'a'.repeat(128) }, { url: source.archive.url, type: 'zip', bytes: body.length },
      { ...source.archive, sha256: 'A'.repeat(64) }, { ...source.archive, sha256: 'a'.repeat(63) },
      { url: source.archive.url, type: 'zip', bytes: body.length, sha512: 'a'.repeat(127) },
      { url: source.archive.url, type: 'zip', bytes: body.length, sha1: 'a'.repeat(40) }];
    const beforeDownloads = downloads;
    for (const archive of invalid) {
      assert.equal(isKnownManagedInstallationArchive(archive), false);
      assert.equal(isKnownManagedInstallationDescriptor({ ...source, archive }), false);
      assert.throws(() => validatePinnedInstallDescriptor({ ...source, archive }, dependencies), /canonical tool\/profile\/recipe descriptor/);
      await assert.rejects(installPinnedManagedTool({ toolingRoot, descriptor: { ...source, archive }, ...dependencies }));
    }
    assert.equal(downloads, beforeDownloads, 'unknown/ambiguous integrity fails before storage writes or download authority');
  });
} finally { await rmDirRecursive(temporary); }
console.log('Managed archive admission and every receipt reader require one exact SHA256 or SHA512 source digest.');
