import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import AdmZip from 'adm-zip';
import { installPinnedManagedTool } from '../../../tools/tooling/managed-install.js';
import { ensureManagedGoSdk } from '../../../tools/tooling/install-go-sdk.js';
import { ensureManagedClangd } from '../../../tools/tooling/install-clangd.js';
import { GO_ARCHIVE_ORIGIN, GO_RELEASE_INDEX_URL } from '../../../src/shared/managed-go.js';
import { CLANGD_RELEASE_INDEX_URL, resolveClangdArchiveTarget } from '../../../src/shared/managed-clangd.js';
import { getArchiveExtractionSession } from '../../../tools/shared/archive-extraction.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: actual installer, Zip parser, FileHandle and storage owners.
// Only network metadata/bytes and never-reached verifier are inert injections.
const temporary = await makeTempDir('poc-archive-consumer-resource-');
const open = fs.open;
const handles = [];
const rejected = async action => {
  let failed = false, error;
  try { await action(); } catch (value) { failed = true; error = value; }
  assert.equal(failed, true); return error;
};
const contains = (value, expected) => {
  const queue = [value], seen = new Set();
  while (queue.length) {
    const current = queue.pop(); if (current === expected) return true;
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current); queue.push(current.cause, ...(Array.isArray(current.errors) ? current.errors : []));
  }
  return false;
};
try {
  const zip = new AdmZip(); zip.addFile('package/tool', Buffer.from('inert package layout'));
  const body = zip.toBuffer(), sha256 = createHash('sha256').update(body).digest('hex');
  const estimate = { complete: true, writes: [{ destination: 'artifacts', requiredBytes: 1024 * 1024 }] };
  for (const kind of ['managed', 'go', 'clangd']) {
    const home = path.join(temporary, kind, 'home'), toolingRoot = path.join(temporary, kind, 'tooling');
    const coordinationRoot = path.join(home, 'state', 'storage-access');
    await withTemporaryEnv({ PAIROFCLEATS_HOME: home }, async () => {
      let allowed = false, closes = 0, nativeReads = 0;
      const original = Object.freeze(Object.assign(new Error(`frozen ${kind} archive source close`), { code: 'EIO' }));
      fs.open = async (file, ...args) => {
        const handle = await open(file, ...args);
        if (!String(file).startsWith(toolingRoot + path.sep) || !String(file).endsWith('.zip')) return handle;
        handles.push(handle);
        const owned = {};
        for (const method of ['read', 'write', 'stat']) owned[method] = function (...values) {
          assert.equal(this, owned); if (method === 'read') nativeReads += 1;
          return handle[method](...values);
        };
        owned.close = async function () {
          assert.equal(this, owned); closes += 1;
          if (!allowed) throw original;
          await handle.close();
        };
        return owned;
      };
      let invoke;
      if (kind === 'managed') {
        const descriptor = { schemaVersion: 1, toolId: 'fixture-archive', recipeId: 'fixture', version: '1.0.0',
          platform: process.platform, arch: process.arch,
          archive: { url: 'https://fixture.invalid/archive-v1.zip', type: 'zip', bytes: body.length, sha256 },
          root: 'package', command: 'tool', args: [], requiredFiles: ['tool'], storageEstimate: estimate };
        invoke = () => installPinnedManagedTool({ toolingRoot, descriptor, approvedOrigins: ['https://fixture.invalid'],
          download: async ({ url }) => ({ sourceUrl: url, body }),
          verify: () => assert.fail('archive close must precede verification') });
      } else if (kind === 'go') {
        const version = 'go1.25.3', filename = `${version}.windows-amd64.zip`;
        const index = [{ version, stable: true, files: [{ filename, kind: 'archive', os: 'windows', arch: 'amd64',
          version, size: body.length, sha256 }] }];
        invoke = () => ensureManagedGoSdk({ toolingRoot, platform: 'win32', arch: 'x64', storageEstimate: estimate,
          dependencies: { download: async ({ url }) => {
            assert.ok(url === GO_RELEASE_INDEX_URL || url === GO_ARCHIVE_ORIGIN + filename);
            return { sourceUrl: url, body: url === GO_RELEASE_INDEX_URL ? Buffer.from(JSON.stringify(index)) : body };
          }, probe: () => assert.fail('archive close must precede SDK verification') } });
      } else {
        const target = resolveClangdArchiveTarget({ platform: 'win32', arch: 'x64' });
        const version = '21.1.0', filename = `clangd-${target.assetPlatform}-${version}.zip`;
        const sourceUrl = `https://github.com/clangd/clangd/releases/download/${version}/${filename}`;
        const release = { tag_name: version, draft: false, prerelease: false,
          assets: [{ name: filename, browser_download_url: sourceUrl, digest: 'sha256:' + sha256, size: body.length }] };
        invoke = () => ensureManagedClangd({ toolingRoot, platform: 'win32', arch: 'x64', dependencies: {
          download: async ({ url }) => {
            assert.ok(url === CLANGD_RELEASE_INDEX_URL || url === sourceUrl);
            return { sourceUrl: url, body: url === CLANGD_RELEASE_INDEX_URL ? Buffer.from(JSON.stringify(release)) : body };
          }, probe: () => assert.fail('archive close must precede clangd verification') } });
      }
      const failure = await rejected(invoke);
      assert.equal(contains(failure, original), true);
      assert.ok(getArchiveExtractionSession(failure));
      assert.equal(closes, 1, 'outer cleanup must not retry known failed native close');
      assert.equal(failure.cacheOwnershipReleased(), false);
      const readsBeforeRecovery = nativeReads;
      if (kind !== 'clangd') assert.equal((await inspectStorageAccess(toolingRoot, { coordinationRoot })).protected, true);
      allowed = true;
      if (kind === 'managed') {
        const held = failure.managedInstallSession;
        assert.equal(await held.releaseAfterSettlement({ resourceId: held.resourceId, settled: true, pending: false }), true);
      } else if (kind === 'go') {
        assert.equal(await failure.goSdkInstallSession.releaseAfterClosure(), true);
      } else {
        const held = getArchiveExtractionSession(failure);
        assert.deepEqual(await held.releaseAfterClose(), { resourceId: held.resourceId, settled: true, pending: false });
      }
      assert.equal(closes, 2);
      assert.equal(nativeReads, readsBeforeRecovery, 'exact recovery never replays extraction');
      assert.equal(failure.cacheOwnershipReleased(), true);
      if (kind !== 'clangd') assert.equal((await inspectStorageAccess(toolingRoot, { coordinationRoot })).protected, false);
      fs.open = open;
    });
  }
} finally {
  fs.open = open;
  for (const handle of handles) { try { await handle.close(); } catch {} }
  await rmDirRecursive(temporary);
}
console.log('Actual managed/Go/clangd archive consumers settle original extraction owners before outer cleanup.');
