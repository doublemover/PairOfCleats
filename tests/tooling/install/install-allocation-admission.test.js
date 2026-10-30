#!/usr/bin/env node
// Source regression authored for the development batch; UNVALIDATED.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runInstallWithStorageAdmission } from '../../../tools/tooling/install-storage.js';
import { ensureManagedGoSdk } from '../../../tools/tooling/install-go-sdk.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { resolveStorageLayout } from '../../../src/shared/storage/layout.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';

const suite = path.join(process.cwd(), '.tmp', 'tasks', 'install-allocation-admission');
await fs.mkdir(suite, { recursive: true });
const root = await fs.mkdtemp(path.join(suite, 'case-'));
try {
  await withTemporaryEnv({ PAIROFCLEATS_HOME: path.join(root, 'home') }, async () => {
    const toolingRoot = path.join(root, 'tools');
    let executed = 0;
    await assert.rejects(runInstallWithStorageAdmission({ toolingRoot }, async () => { executed++; }), { code: 'ERR_INSTALL_STORAGE_ESTIMATE_REQUIRED' });
    await assert.rejects(ensureManagedGoSdk({ toolingRoot, dependencies: { download: () => { throw new Error('Unknown capacity must precede even release-index acquisition'); } } }), { code: 'ERR_INSTALL_STORAGE_ESTIMATE_REQUIRED' });
    assert.equal(executed, 0);
    await assert.rejects(fs.stat(toolingRoot), { code: 'ENOENT' });
    const storageEstimate = { complete: true, writes: [{ destination: 'artifacts', requiredBytes: 1024 }] };
    const layout = resolveStorageLayout({ overrides: { tooling: toolingRoot } });
    const coordinationRoot = path.join(layout.descriptors.state.path, 'storage-access');
    const result = await runInstallWithStorageAdmission({ toolingRoot, storageEstimate }, async () => {
      executed++;
      assert.equal((await inspectStorageAccess(toolingRoot, { coordinationRoot })).protected, true);
      await fs.mkdir(toolingRoot, { recursive: true });
      await fs.writeFile(path.join(toolingRoot, 'inert-owned-bytes'), 'fixture');
      return 'publication-finished';
    });
    assert.equal(result.value, 'publication-finished');
    assert.equal((await inspectStorageAccess(toolingRoot, { coordinationRoot })).protected, false);
    await assert.rejects(runInstallWithStorageAdmission({ toolingRoot,
      storageEstimate: { complete: true, writes: [{ destination: 'artifacts', requiredBytes: 1024, hardBytes: 1 }] }
    }, async () => { throw new Error('Hard budget must refuse before writer invocation'); }), { code: 'ERR_STORAGE_ADMISSION' });
    assert.equal(await fs.readFile(path.join(toolingRoot, 'inert-owned-bytes'), 'utf8'), 'fixture', 'admission never cleans existing assets to fit');
  });
} finally { await fs.rm(root, { recursive: true, force: true }); }

console.log('Installer actual destinations require declared allocation before archive/SDK writes.');
