import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ensureManagedGoSdk } from '../../../tools/tooling/install-go-sdk.js';
import { copyInstallDownloadBytes, copyPinnedArchiveBytes } from '../../../tools/tooling/install-shared.js';
import { GO_RELEASE_INDEX_URL, resolveManagedGoSdk } from '../../../src/shared/managed-go.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { assertNoSymlinkPath } from '../../../src/shared/contained-file.js';
import { ensureTestingEnv, withTemporaryEnv } from '../../helpers/test-env.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';
import { rmDirRecursive } from '../../helpers/temp.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/go-sdk-input-ownership/')[1];
assert.ok(['sealed-archive-before-write', 'sealed-index-before-parse', 'pending-index-before-fields', 'pending-archive-before-fields',
  'revoked-index-source', 'invalid-index-bound', 'intrinsic-buffer-view'].includes(mode));
const root = fileURLToPath(new URL('../../../', import.meta.url)), scope = path.join(root, '.tmp', 'tests', 'go-sdk-inputs');
assertNoSymlinkPath(root, scope, { allowMissing: true }); await fs.mkdir(scope, { recursive: true });
const temporary = await fs.mkdtemp(path.join(scope, 'case-')), toolingRoot = path.join(temporary, 'tools'), home = path.join(temporary, 'home');
const versions = ['go1.27.0', 'go1.27.1'], bodies = new Map(versions.map(version => [version, Buffer.from('explicit inert archive ' + version)]));
const releases = versions.map(version => ({ stable: true, version, files: [{ filename: `${version}.windows-amd64.zip`, version,
  os: 'windows', arch: 'amd64', kind: 'archive', size: bodies.get(version).length,
  sha256: createHash('sha256').update(bodies.get(version)).digest('hex') }] }));
const indexBytes = Buffer.from(JSON.stringify(releases));
const input = version => ({ toolingRoot, cwd: temporary, baseEnv: {}, platform: 'win32', arch: 'x64', version,
  storageEstimate: { complete: true, writes: [{ destination: 'artifacts', requiredBytes: 2 * 1024 * 1024 }] } });
let ready = true, original, borrowed, reads = 0, downloads = 0, extractions = 0, probes = 0, mutated = false;
const dependencies = version => ({
  download: async ({ url }) => { downloads++; return { sourceUrl: url, body: url === GO_RELEASE_INDEX_URL ? indexBytes : bodies.get(version) }; },
  extract: async (archive, destination) => {
    extractions++; assert.deepEqual(await fs.readFile(archive), bodies.get(version), 'the real writer delivers the exact pinned bytes to extraction');
    for (const relative of ['go/bin/go.exe', 'go/bin/gofmt.exe', 'go/pkg/tool/windows_amd64/compile.exe', 'go/src/runtime/runtime.go']) {
      const filename = path.join(destination, relative); await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename, 'explicit inert SDK');
    }
    await fs.writeFile(path.join(destination, 'go', 'VERSION'), version);
  },
  probe: async (_command, { resourceId }) => { probes++; return { ok: true, stdout: `go version ${version} windows/amd64`,
    settlement: { resourceId, settled: true, pending: false } }; }
});
try {
  await withTemporaryEnv(ensureTestingEnv({ PAIROFCLEATS_HOME: home }), async () => {
    if (mode === 'intrinsic-buffer-view') {
      const backing = Buffer.from('prefix:bounded:suffix'), view = backing.subarray(7, 14); let hooks = 0;
      for (const field of ['length', 'byteLength', 'byteOffset', 'buffer']) Object.defineProperty(view, field, { get() { hooks++; throw new Error('borrowed metadata hook'); } });
      const owned = copyPinnedArchiveBytes(view, 7); assert.deepEqual(owned, Buffer.from('bounded')); assert.equal(hooks, 0);
      backing.fill(120); assert.deepEqual(owned, Buffer.from('bounded'));
      assert.equal(copyInstallDownloadBytes(Buffer.alloc(9), 8), null); assert.equal(copyPinnedArchiveBytes(Buffer.alloc(7), 8), null);
      assert.equal(copyInstallDownloadBytes({ toString() { hooks++; return 'unbounded'; } }, 8), null); assert.equal(hooks, 0);
      return;
    }
    // Actual SDK publication/admission owners; explicit inert archives/probes.
    const previous = await ensureManagedGoSdk({ ...input(versions[0]), dependencies: dependencies(versions[0]) });
    downloads = 0; extractions = 0; probes = 0;
    const selected = dependencies(versions[1]), ordinaryDownload = selected.download;
    selected.download = async request => {
      const isIndex = request.url === GO_RELEASE_INDEX_URL;
      if (mode === 'invalid-index-bound' && isIndex) { downloads++; return { sourceUrl: request.url, body: Buffer.alloc(2 * 1024 * 1024 + 1) }; }
      if ((mode === 'pending-index-before-fields' && isIndex) || (mode === 'pending-archive-before-fields' && !isIndex)) {
        downloads++; ready = false;
        original = Object.freeze(Object.defineProperties({}, { cacheOwnershipPending: { value: true }, cacheOwnershipReleased: { value: () => ready },
          sourceUrl: { get() { reads++; ready = true; return request.url; } }, body: { get() { reads++; ready = true; return isIndex ? indexBytes : bodies.get(versions[1]); } } }));
        return original;
      }
      if (mode === 'revoked-index-source' && isIndex) {
        downloads++;
        original = Object.freeze(Object.defineProperties({}, { cacheOwnershipReleased: { value: () => ready },
          sourceUrl: { get() { reads++; ready = false; return request.url; } },
          body: { get() { reads++; ready = true; return indexBytes; } } })); return original;
      }
      if ((mode === 'sealed-archive-before-write' && !isIndex) || (mode === 'sealed-index-before-parse' && isIndex)) {
        downloads++; borrowed = Buffer.from(isIndex ? indexBytes : bodies.get(versions[1]));
        // Neither conversion nor metadata hooks on caller-owned buffers run.
        Object.defineProperty(borrowed, 'toString', { value() { reads++; throw new Error('borrowed conversion must not run'); } });
        return { body: borrowed, get sourceUrl() { queueMicrotask(() => { mutated = true; borrowed.fill(122); }); return request.url; } };
      }
      return ordinaryDownload(request);
    };
    let result, failure;
    try { result = await ensureManagedGoSdk({ ...input(versions[1]), dependencies: selected }); } catch (error) { failure = error; }
    const coordinationRoot = path.join(home, 'state', 'storage-access'), sdkCache = path.join(toolingRoot, 'sdk', 'go');
    if (mode.startsWith('sealed-')) {
      assert.equal(failure, undefined); assert.equal(result.version, versions[1]); assert.equal(result.reused, false);
      assert.equal(mutated, true); assert.equal(reads, 0); assert.equal(downloads, 2); assert.equal(extractions, 1); assert.equal(probes, 1);
      assert.notDeepEqual(Buffer.from(borrowed), mode === 'sealed-index-before-parse' ? indexBytes : bodies.get(versions[1]));
      assert.equal((await inspectStorageAccess(toolingRoot, { coordinationRoot })).protected, false);
    } else {
      assert.ok(failure); assert.equal(extractions, 0); assert.equal(probes, 0);
      assert.equal(resolveManagedGoSdk(toolingRoot, { platform: 'win32', arch: 'x64' }).version, previous.version);
      if (mode === 'invalid-index-bound') {
        assert.equal(downloads, 1); assert.equal((await inspectStorageAccess(toolingRoot, { coordinationRoot })).protected, false);
      } else {
        assert.equal(errorGraphIncludes(failure, original), true); assert.equal(reads, mode === 'revoked-index-source' ? 1 : 0);
        assert.equal(downloads, mode === 'pending-archive-before-fields' ? 2 : 1);
        const recovery = mode === 'pending-archive-before-fields' ? failure.goSdkInstallSession : failure.installActionSession;
        assert.ok(recovery); assert.equal((await inspectStorageAccess(toolingRoot, { coordinationRoot })).protected, true);
        if (recovery.transaction) assert.ok((await fs.stat(recovery.transaction)).isDirectory());
        else assert.equal((await fs.readdir(sdkCache)).some(name => name.startsWith('.install-')), false, 'index refusal precedes transaction creation');
        await assert.rejects(recovery.releaseAfterClosure({ resourceId: recovery.resourceId, settled: true, pending: false }));
        assert.equal((await inspectStorageAccess(toolingRoot, { coordinationRoot })).protected, true, 'a supplied receipt cannot override original work');
        ready = true; assert.deepEqual(await Promise.all([recovery.releaseAfterClosure(), recovery.releaseAfterClosure()]), [true, true]);
        assert.equal((await inspectStorageAccess(toolingRoot, { coordinationRoot })).protected, false);
        if (recovery.transaction) await assert.rejects(fs.stat(recovery.transaction), { code: 'ENOENT' });
        assert.equal(resolveManagedGoSdk(toolingRoot, { platform: 'win32', arch: 'x64' }).version, previous.version);
      }
    }
  });
} finally {
  ready = true; assertNoSymlinkPath(root, temporary);
  assert.equal(path.dirname(await fs.realpath(temporary)), await fs.realpath(scope)); await rmDirRecursive(temporary, { retries: 0 });
}
console.log('Go SDK acquisition owns bounded index/archive bytes and retains original resource observations before metadata.');
