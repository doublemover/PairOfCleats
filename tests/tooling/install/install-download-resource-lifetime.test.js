// Source regression authored for the development batch; UNVALIDATED.
// Actual install storage owners, inert HTTP transport; no network or tool runs.
import assert from 'node:assert/strict';
import { errorGraphMatches } from '../../helpers/error-graph.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { downloadToBuffer } from '../../../tools/tooling/install-shared.js';
import { ensureManagedGoSdk } from '../../../tools/tooling/install-go-sdk.js';
import { installPinnedManagedTool } from '../../../tools/tooling/managed-install.js';
import { GO_RELEASE_INDEX_URL } from '../../../src/shared/managed-go.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';

const root = await makeTempDir('install-download-resource-lifetime-');
const active = [];
try {
  const home = path.join(root, 'home');
  const coordinationRoot = path.join(home, 'state', 'storage-access');
  const storageEstimate = { complete: true, writes: [{ destination: 'artifacts', requiredBytes: 1024 * 1024 }] };
  await withTemporaryEnv({ PAIROFCLEATS_HOME: home, PAIROFCLEATS_CACHE_ROOT: '', PAIROFCLEATS_TESTING: '1' }, async () => {
    const archiveBytes = Buffer.from('inert fixture archive');
    const sha256 = createHash('sha256').update(archiveBytes).digest('hex');
    const releases = [{ stable: true, version: 'go1.27.1', files: [{ filename: 'go1.27.1.linux-amd64.tar.gz',
      version: 'go1.27.1', os: 'linux', arch: 'amd64', kind: 'archive', size: archiveBytes.length, sha256 }] }];
    for (const stage of ['go-index', 'go-archive', 'managed-archive']) {
      const toolingRoot = path.join(root, stage);
      let allowClose = false;
      const download = async request => {
        if (stage === 'go-archive' && request.url === GO_RELEASE_INDEX_URL) return {
          sourceUrl: request.url, body: Buffer.from(JSON.stringify(releases))
        };
        return downloadToBuffer({ ...request, fetchImpl: async () => ({ ok: true, status: 200, url: request.url,
          headers: { get: () => String(request.maxBytes + 1) },
          body: { cancel: async () => { if (!allowClose) throw new Error('inert response teardown is blocked'); } }
        }) });
      };
      const descriptor = { schemaVersion: 1, toolId: 'fixture-download', recipeId: 'fixture-download', version: '1.0.0',
        platform: process.platform, arch: process.arch, storageEstimate,
        archive: { type: 'zip', url: 'https://official.example.test/fixture.zip', bytes: archiveBytes.length, sha256 },
        command: 'bin/fixture', requiredFiles: ['bin/fixture'], args: [] };
      let pending;
      await assert.rejects(stage === 'managed-archive'
        ? installPinnedManagedTool({ toolingRoot, descriptor, approvedOrigins: ['https://official.example.test'], download,
          verify: async () => { throw new Error('pending download cannot start a verifier'); } })
        : ensureManagedGoSdk({ toolingRoot, storageEstimate, platform: 'linux', arch: 'x64', dependencies: { download } }),
      error => { pending = error; return error.cacheOwnershipPending === true && Boolean(error.downloadSession); });
      const release = stage === 'go-index' ? () => pending.installDownloadSession.releaseAfterClosure()
        : stage === 'go-archive' ? () => pending.goSdkInstallSession.releaseAfterClosure()
          : () => pending.managedInstallSession.releaseAfterSettlement({ resourceId: pending.managedInstallSession.resourceId,
            settled: true, pending: false });
      active.push({ pending, release, close: () => { allowClose = true; } });
      assert.equal((await inspectStorageAccess(toolingRoot, { coordinationRoot })).protected, true);
      await assert.rejects(release(), error => errorGraphMatches(error, /teardown is blocked/));
      assert.equal((await inspectStorageAccess(toolingRoot, { coordinationRoot })).protected, true,
        'failed actual response teardown cannot release the install category or allocation');
      if (stage === 'go-archive') assert.equal((await fs.stat(pending.goSdkInstallSession.transaction)).isDirectory(), true);
      if (stage === 'managed-archive') assert.equal((await fs.stat(pending.managedInstallSession.stage)).isDirectory(), true);
      allowClose = true;
      await release();
      active.pop();
      assert.equal(pending.cacheOwnershipReleased(), true);
      assert.equal((await inspectStorageAccess(toolingRoot, { coordinationRoot })).protected, false);
      assert.equal((await fs.readdir(path.join(coordinationRoot, 'write-reservations'))).length, 0);
    }
  });
} finally {
  for (const entry of active) { entry.close(); await entry.release(); }
  await rmDirRecursive(root);
}
console.log('Managed archive and Go index/archive owners retain storage until actual HTTP teardown reconciliation.');
