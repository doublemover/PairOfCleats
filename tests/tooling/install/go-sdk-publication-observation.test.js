import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ensureManagedGoSdk } from '../../../tools/tooling/install-go-sdk.js';
import { GO_RELEASE_INDEX_URL, resolveManagedGoSdk } from '../../../src/shared/managed-go.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { assertNoSymlinkPath } from '../../../src/shared/contained-file.js';
import { ensureTestingEnv, withTemporaryEnv } from '../../helpers/test-env.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';
import { rmDirRecursive } from '../../helpers/temp.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/go-sdk-publication-observation/')[1];
assert.ok(['root-capability-revocation', 'nested-capability-revocation', 'post-verification-file-read', 'function-failure-retirement'].includes(mode));
const root = fileURLToPath(new URL('../../../', import.meta.url)), scope = path.join(root, '.tmp', 'tests', 'go-sdk-publication');
assertNoSymlinkPath(root, scope, { allowMissing: true }); await fs.mkdir(scope, { recursive: true });
const temporary = await fs.mkdtemp(path.join(scope, 'case-')), toolingRoot = path.join(temporary, 'tools'), home = path.join(temporary, 'home');
const versions = ['go1.27.0', 'go1.27.1'], bodies = new Map(versions.map(version => [version, Buffer.from('explicit inert SDK ' + version)]));
const releases = versions.map(version => ({ stable: true, version, files: [{ filename: `${version}.windows-amd64.zip`,
  version, os: 'windows', arch: 'amd64', kind: 'archive', size: bodies.get(version).length,
  sha256: createHash('sha256').update(bodies.get(version)).digest('hex') }] }));
const input = version => ({ toolingRoot, cwd: temporary, baseEnv: {}, platform: 'win32', arch: 'x64', version,
  storageEstimate: { complete: true, writes: [{ destination: 'artifacts', requiredBytes: 2 * 1024 * 1024 }] } });
let ready = true, original, command, admittedRead = false, stdoutReads = 0, coercions = 0, downloads = 0;
const open = fsSync.openSync, nativePath = filename => process.platform === 'win32' ? path.toNamespacedPath(filename).toLowerCase() : path.resolve(filename);
const dependencies = (version, probe) => ({
  download: async ({ url }) => { downloads++; return { sourceUrl: url, body: url === GO_RELEASE_INDEX_URL ? Buffer.from(JSON.stringify(releases)) : bodies.get(version) }; },
  extract: async (_archive, destination) => {
    for (const relative of ['go/bin/go.exe', 'go/bin/gofmt.exe', 'go/pkg/tool/windows_amd64/compile.exe', 'go/src/runtime/runtime.go']) {
      const filename = path.join(destination, relative); await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename, 'explicit inert SDK bytes');
    }
    await fs.writeFile(path.join(destination, 'go', 'VERSION'), version);
  }, probe
});
try {
  await withTemporaryEnv(ensureTestingEnv({ PAIROFCLEATS_HOME: home }), async () => {
    // Real SDK publication/storage owners; inert archives and explicit probe
    // callbacks. These are not real Go executable/native qualification claims.
    const previous = await ensureManagedGoSdk({ ...input(versions[0]), dependencies: dependencies(versions[0], async (_command, { resourceId }) => ({
      ok: true, stdout: `go version ${versions[0]} windows/amd64`, settlement: { resourceId, settled: true, pending: false }
    })) }); assert.equal(previous.version, versions[0]); downloads = 0;
    const observer = value => Object.defineProperties(value, { cacheOwnershipPending: { value: false }, cacheOwnershipReleased: { value: () => ready } });
    const probe = async (filename, { resourceId }) => {
      command = filename;
      const settlement = { resourceId, settled: true, pending: false };
      if (mode === 'function-failure-retirement') {
        ready = false; original = observer(function originalGoVerifierFailure() {});
        Object.defineProperties(original, { settlement: { value: settlement }, [Symbol.toPrimitive]: { value() { coercions++; return 'coerced'; } } });
        Object.freeze(original); throw original;
      }
      original = { settlement };
      if (mode === 'nested-capability-revocation') observer(settlement); else observer(original);
      Object.defineProperties(original, { ok: { get() { if (mode !== 'post-verification-file-read') ready = false; return true; } },
        stdout: { get() { stdoutReads++; if (mode !== 'post-verification-file-read') ready = true; return `go version ${versions[1]} windows/amd64`; } } });
      Object.freeze(settlement); return Object.freeze(original);
    };
    if (mode === 'post-verification-file-read') fsSync.openSync = (filename, ...args) => {
      if (command && typeof filename === 'string' && !admittedRead && nativePath(filename) === nativePath(command)) { admittedRead = true; ready = false; }
      return open(filename, ...args);
    };
    let failure;
    try { await ensureManagedGoSdk({ ...input(versions[1]), dependencies: dependencies(versions[1], probe) }); } catch (error) { failure = error; }
    finally { fsSync.openSync = open; }
    assert.ok(failure); assert.equal(errorGraphIncludes(failure, original), true); assert.equal(coercions, 0);
    assert.equal(stdoutReads, mode === 'post-verification-file-read' ? 1 : 0);
    if (mode === 'post-verification-file-read') assert.equal(admittedRead, true);
    const recovery = failure.goSdkInstallSession; assert.ok(recovery); assert.ok((await fs.stat(recovery.transaction)).isDirectory());
    const coordinationRoot = path.join(home, 'state', 'storage-access');
    assert.equal((await inspectStorageAccess(toolingRoot, { coordinationRoot })).protected, true);
    assert.equal(resolveManagedGoSdk(toolingRoot, { platform: 'win32', arch: 'x64' }).version, versions[0]);
    await assert.rejects(recovery.releaseAfterClosure()); assert.ok((await fs.stat(recovery.transaction)).isDirectory());
    ready = true; assert.equal(await recovery.releaseAfterClosure(), true);
    assert.equal((await inspectStorageAccess(toolingRoot, { coordinationRoot })).protected, false);
    await assert.rejects(fs.stat(recovery.transaction), { code: 'ENOENT' });
    assert.equal(downloads, 2, 'original index/archive acquisition is not repeated during retirement');
    assert.equal(resolveManagedGoSdk(toolingRoot, { platform: 'win32', arch: 'x64' }).version, versions[0]);
  });
} finally {
  ready = true; fsSync.openSync = open; assertNoSymlinkPath(root, temporary);
  assert.equal(path.dirname(await fs.realpath(temporary)), await fs.realpath(scope)); await rmDirRecursive(temporary, { retries: 0 });
}
console.log('Original Go SDK verification observations protect receipt publication, activation and transaction cleanup.');
