// UNVALIDATED implementation regression: archive bytes and child operations are inert.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ensureManagedClangd, probeInstalledClangd } from '../../../tools/tooling/install-clangd.js';
import { CLANGD_ARCHIVE_LIMITS, CLANGD_MAX_DOWNLOAD_BYTES, CLANGD_RELEASE_INDEX_URL,
  CLANGD_STORAGE_ESTIMATE, resolveManagedClangd } from '../../../src/shared/managed-clangd.js';
import { downloadToBuffer } from '../../../tools/tooling/install-shared.js';
import { getToolingRegistry, selectInstallPlan } from '../../../tools/tooling/utils.js';
import { createToolInstallPreview } from '../../../tools/tooling/install-preview.js';
import { resolveDeclaredInstallAdmission } from '../../../tools/tooling/install-allocation-contract.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { isPathWithinRoot } from '../../../src/shared/file-paths.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('clangd-owned-acquisition/')[1];
const cases = ['registry', 'publication', 'download-index', 'download-archive', 'pending-probe', 'frozen-probe',
  'missing-receipt', 'wrong-version', 'abort-download', 'abort-probe', 'probe-success', 'probe-pending', 'probe-cancellation'];
assert.ok(cases.includes(selected), 'select one independently bounded case');
const { dir } = await prepareIsolatedTestCacheDir(`clangd-owned-${selected}`);
const home = path.join(dir, 'home'), toolingRoot = path.join(home, 'tooling');
const coordinationRoot = path.join(home, 'state', 'storage-access');
applyTestEnv({ cacheRoot: path.join(dir, 'cache'), extraEnv: {
  PAIROFCLEATS_HOME: home, PAIROFCLEATS_TRUSTED_CONFIG: null
} });
const version = '23.1.0', archiveBytes = Buffer.from('explicit inert archive fixture');
const sha256 = createHash('sha256').update(archiveBytes).digest('hex');
const filename = `clangd-windows-${version}.zip`;
const sourceUrl = `https://github.com/clangd/clangd/releases/download/${version}/${filename}`;
const release = { tag_name: version, draft: false, prerelease: false,
  assets: [{ name: filename, browser_download_url: sourceUrl, size: archiveBytes.length, digest: `sha256:${sha256}` }] };
const binary = Buffer.alloc(128);
binary.writeUInt16LE(0x5a4d); binary.writeUInt32LE(64, 0x3c);
binary.writeUInt32LE(0x4550, 64); binary.writeUInt16LE(0x8664, 68);
const protectedStorage = async expected => {
  assert.equal((await inspectStorageAccess(toolingRoot, { coordinationRoot })).protected, expected);
  const reservations = await fs.readdir(path.join(coordinationRoot, 'write-reservations'));
  assert.equal(reservations.length, expected ? 1 : 0, 'one archive operation owns one allocation, without an outer package wrapper');
  if (expected) {
    const receipt = JSON.parse(await fs.readFile(path.join(coordinationRoot, 'write-reservations', reservations[0]), 'utf8'));
    assert.equal(receipt.root, toolingRoot);
    assert.equal(receipt.requiredBytes, CLANGD_STORAGE_ESTIMATE.writes[0].requiredBytes);
  }
};
let downloads = 0, probes = 0, extracts = 0, ready = false, recovery = null;
const controller = new AbortController();
const original = Object.freeze(Object.assign(new Error('original inert child or response is still owned'), {
  cacheOwnershipPending: true, cacheOwnershipReleased() { assert.equal(this, original); return ready; }
}));
const dependencies = {
  download: async request => {
    downloads++;
    await protectedStorage(true);
    assert.equal(request.signal, controller.signal);
    return { sourceUrl: request.url,
      body: request.url === CLANGD_RELEASE_INDEX_URL ? Buffer.from(JSON.stringify(release)) : archiveBytes };
  },
  extract: async (_archive, destination, type, limits) => {
    extracts++; await protectedStorage(true);
    assert.equal(type, 'zip'); assert.equal(limits, CLANGD_ARCHIVE_LIMITS);
    assert.equal(isPathWithinRoot(destination, toolingRoot), true);
    const packageRoot = path.join(destination, `clangd_${version}`);
    await fs.mkdir(path.join(packageRoot, 'bin'), { recursive: true });
    await fs.writeFile(path.join(packageRoot, 'bin', 'clangd.exe'), binary);
    const resources = path.join(packageRoot, 'lib', 'clang', '23', 'include');
    await fs.mkdir(resources, { recursive: true });
    await fs.writeFile(path.join(resources, 'stddef.h'), 'explicit inert header fixture');
  },
  probe: async (_command, input) => {
    probes++; await protectedStorage(true);
    assert.equal(input.cwd, dir); assert.equal(input.signal, controller.signal);
    assert.ok(isPathWithinRoot(input.env.TEMP, toolingRoot));
    assert.equal(input.env.TMP, input.env.TEMP); assert.equal(input.env.TMPDIR, input.env.TEMP);
    assert.equal(input.env.POC_CLANGD_FIXTURE, 'retained');
    return { ok: true, stdout: `clangd version ${version}\n`,
      settlement: { resourceId: input.resourceId, settled: true, pending: false } };
  }
};
const install = () => ensureManagedClangd({ toolingRoot, cwd: dir, platform: 'win32', arch: 'x64',
  baseEnv: { POC_CLANGD_FIXTURE: 'retained' }, signal: controller.signal, dependencies });
try {
  if (selected === 'registry') {
    const tool = getToolingRegistry(toolingRoot, dir).find(entry => entry.id === 'clangd');
    const recipe = selectInstallPlan(tool, 'cache', false).plan;
    assert.equal(recipe.ownedAcquisition, 'official-clangd-archive');
    assert.equal(recipe.cmd, undefined, 'the canonical operation does not launch another Node installer');
    assert.equal(resolveDeclaredInstallAdmission(recipe).state, 'estimate-declared');
    assert.equal(recipe.storageEstimate.writes.length, 1);
    assert.ok(recipe.storageEstimate.writes[0].requiredBytes >= CLANGD_MAX_DOWNLOAD_BYTES + CLANGD_ARCHIVE_LIMITS.maxBytes);
    const preview = createToolInstallPreview({ tools: [tool] }, {
      locate: () => ({ path: null }), provisioning: () => ({ steps: [] })
    });
    assert.equal(preview.entries[0].action.kind, recipe.ownedAcquisition);
    assert.equal(preview.entries[0].action.releaseSelection.version, null, 'latest stable version is unresolved until official metadata is read');
    assert.equal(preview.entries[0].action.maximumDownloadBytes, CLANGD_MAX_DOWNLOAD_BYTES);
    assert.equal(preview.entries[0].blockers.length, 0); assert.equal(preview.execution, 'none');
    await assert.rejects(fs.stat(toolingRoot), { code: 'ENOENT' });
  } else if (selected === 'publication') {
    const installed = await install();
    assert.equal(installed.reused, false); assert.equal(installed.archiveSha256, sha256);
    await protectedStorage(false);
    const reused = await install();
    assert.equal(reused.reused, true); assert.equal(downloads, 2); assert.equal(probes, 1); assert.equal(extracts, 1);
    assert.equal((await fs.readdir(path.join(toolingRoot, 'servers', 'clangd'))).some(value => value.startsWith('.install-')), false);
    assert.equal(resolveManagedClangd(toolingRoot, { platform: 'win32', arch: 'x64' }).command, installed.command);
  } else if (selected.startsWith('download-')) {
    const normal = dependencies.download;
    dependencies.download = async request => {
      if (selected === 'download-archive' && request.url === CLANGD_RELEASE_INDEX_URL) return normal(request);
      return downloadToBuffer({ ...request, fetchImpl: async () => ({ ok: true, status: 200,
        headers: { get: () => String(request.maxBytes + 1) },
        body: { cancel: async () => { if (!ready) throw original; } } }) });
    };
    let pending;
    await assert.rejects(install(), error => { pending = error; return error.cacheOwnershipPending === true && errorGraphIncludes(error, original); });
    recovery = () => (selected === 'download-index' ? pending.installDownloadSession : pending.installArchiveSession).releaseAfterClosure();
    await protectedStorage(true);
    await assert.rejects(recovery()); await protectedStorage(true);
    ready = true; await recovery(); recovery = null;
    await protectedStorage(false); assert.equal(probes, 0);
  } else if (['pending-probe', 'frozen-probe', 'missing-receipt'].includes(selected)) {
    const normal = dependencies.probe;
    dependencies.probe = async (command, input) => {
      await normal(command, input);
      if (selected === 'frozen-probe') throw original;
      if (selected === 'missing-receipt') return { ok: true, stdout: `clangd version ${version}\n`,
        cacheOwnershipReleased() { return ready; } };
      return probeInstalledClangd(command, input, { spawn: async () => { throw original; } });
    };
    let pending;
    await assert.rejects(install(), error => { pending = error; return error.cacheOwnershipPending === true
      && (selected === 'missing-receipt' || errorGraphIncludes(error, original)); });
    recovery = () => pending.installArchiveSession.releaseAfterClosure();
    await protectedStorage(true); await assert.rejects(recovery()); await protectedStorage(true);
    await assert.rejects(fs.stat(path.join(toolingRoot, 'servers', 'clangd', 'current.json')), { code: 'ENOENT' });
    ready = true; await recovery(); recovery = null;
    await protectedStorage(false); assert.equal(probes, 1, 'cleanup never reruns the verifier or publishes a failed operation');
  } else if (selected === 'wrong-version') {
    const normal = dependencies.probe;
    dependencies.probe = async (...args) => ({ ...await normal(...args), stdout: 'clangd version 0.0.1\n' });
    await assert.rejects(install(), error => error.reason === 'clangd_probe_failed');
    await protectedStorage(false);
    assert.deepEqual(await fs.readdir(path.join(toolingRoot, 'servers', 'clangd')), []);
  } else if (selected.startsWith('abort-')) {
    const key = selected === 'abort-download' ? 'download' : 'probe', normal = dependencies[key];
    const cancellation = new Error('cancelled after the inert operation settled');
    dependencies[key] = async (...args) => { const result = await normal(...args); controller.abort(cancellation); return result; };
    await assert.rejects(install(), error => errorGraphIncludes(error, cancellation));
    await protectedStorage(false); assert.equal(extracts, selected === 'abort-download' ? 0 : 1);
    await assert.rejects(fs.stat(path.join(toolingRoot, 'servers', 'clangd', 'current.json')), { code: 'ENOENT' });
  } else {
    const input = { cwd: dir, env: {}, signal: controller.signal, resourceId: 'explicit-fixture-probe' };
    const spawn = async (command, args, options) => {
      assert.equal(command, 'explicit-inert-fixture'); assert.deepEqual(args, ['--version']);
      assert.equal(options.timeoutMs, 10_000); assert.equal(options.maxOutputBytes, 64 * 1024);
      if (selected === 'probe-pending') throw original;
      if (selected === 'probe-cancellation') controller.abort(new Error('settled cancellation fixture'));
      return { exitCode: 0, signal: null, stdout: `clangd version ${version}\n` };
    };
    if (selected === 'probe-success') {
      const result = await probeInstalledClangd('explicit-inert-fixture', input, { spawn });
      assert.equal(result.ok, true); assert.deepEqual(result.settlement, { resourceId: input.resourceId, settled: true, pending: false });
    } else if (selected === 'probe-pending') {
      await assert.rejects(probeInstalledClangd('explicit-inert-fixture', input, { spawn }), error => error.cacheOwnershipPending === true
        && errorGraphIncludes(error, original));
    } else {
      await assert.rejects(probeInstalledClangd('explicit-inert-fixture', input, { spawn }), error => errorGraphIncludes(error, controller.signal.reason)
        && error.settlement?.resourceId === input.resourceId && error.settlement.settled === true);
    }
  }
} finally {
  ready = true;
  if (recovery) await recovery();
  await fs.rm(dir, { recursive: true, force: true });
}
console.log(`clangd owned acquisition ${selected}: inert fixture, no download or native execution qualification.`);
