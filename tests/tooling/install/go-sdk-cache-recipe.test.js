#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  ensureManagedGoSdk, GO_SDK_ARCHIVE_LIMITS, selectOfficialGoSdkArchive
} from '../../../tools/tooling/install-go-sdk.js';
import {
  GO_RELEASE_INDEX_URL, applyManagedGoEnvironment, resolveGoSdkTarget,
  resolveManagedGoSdk, isGoToolchainServer
} from '../../../src/shared/managed-go.js';
import { resolveLocalToolingBinDirs } from '../../../src/shared/tooling-bin-dirs.js';
import { applyToolchainDaemonPolicyEnv } from '../../../src/shared/toolchain-env.js';

process.env.PAIROFCLEATS_TESTING = '1';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-go-sdk-recipe-'));
const version = 'go1.27.1';
const bytes = Buffer.from('inert checksum-verified fixture; never an executable');
const checksum = createHash('sha256').update(bytes).digest('hex');
const linux = resolveGoSdkTarget({ platform: 'linux', arch: 'x64' });
const filename = `${version}.linux-amd64.tar.gz`;
const releases = [{ stable: false, version: 'go1.28rc1', files: [] }, {
  stable: true, version, files: [{ filename, version, os: 'linux', arch: 'amd64',
    kind: 'archive', size: bytes.length, sha256: checksum }]
}];
let downloads = 0;
let extracts = 0;
let probes = 0;
const createDependencies = (overrides = {}) => ({
  download: async (request) => {
    downloads += 1;
    assert.equal(request.redirect, 'error');
    assert.ok(request.maxBytes > 0);
    if (request.url === GO_RELEASE_INDEX_URL) return { sourceUrl: request.url, body: Buffer.from(JSON.stringify(releases)) };
    assert.equal(request.url, `https://dl.google.com/go/${filename}`);
    return { sourceUrl: request.url, body: bytes };
  },
  extract: async (_archive, destination, format, limits) => {
    extracts += 1;
    assert.equal(format, 'tar.gz');
    assert.deepEqual(limits, GO_SDK_ARCHIVE_LIMITS);
    for (const relative of ['go/bin/go', 'go/bin/gofmt', 'go/pkg/tool/linux_amd64/compile', 'go/src/runtime/runtime.go']) {
      const file = path.join(destination, relative);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, bytes);
    }
    await fs.writeFile(path.join(destination, 'go/VERSION'), `${version}\ntime inert fixture\n`);
  },
  probe: async (command, options) => {
    probes += 1;
    assert.ok(command.endsWith('/go/bin/go'));
    assert.equal(options.cwd, root);
    assert.equal(options.env.GOENV, 'off');
    assert.equal(options.env.GOWORK, 'off');
    assert.equal(options.env.GOTOOLCHAIN, 'local');
    assert.equal(options.env.GOMAXPROCS, '1');
    assert.equal(options.env.GOFLAGS, '-p=1');
    return { ok: true, stdout: `go version ${version} linux/amd64` };
  },
  ...overrides
});

try {
  assert.deepEqual(resolveGoSdkTarget({ platform: 'darwin', arch: 'arm64' }), { os: 'darwin', arch: 'arm64', archiveType: 'tar.gz' });
  assert.deepEqual(resolveGoSdkTarget({ platform: 'win32', arch: 'x64' }), { os: 'windows', arch: 'amd64', archiveType: 'zip' });
  assert.equal(resolveGoSdkTarget({ platform: 'darwin', arch: 'ia32' }), null);
  assert.equal(resolveGoSdkTarget({ platform: 'unknown', arch: 'x64' }), null);
  assert.equal(selectOfficialGoSdkArchive(releases, linux).version, version);
  assert.throws(() => selectOfficialGoSdkArchive(releases, linux, 'go1.26.8'), /requested stable/);
  const wrongHash = structuredClone(releases);
  wrongHash[1].files[0].sha256 = 'unverified';
  assert.throws(() => selectOfficialGoSdkArchive(wrongHash, linux), /metadata/);
  const traversal = structuredClone(releases);
  traversal[1].files[0].filename = '../outside.tar.gz';
  assert.throws(() => selectOfficialGoSdkArchive(traversal, linux), /metadata/);

  const toolingRoot = path.join(root, 'shared tooling');
  const sdk = await ensureManagedGoSdk({ toolingRoot, cwd: root, baseEnv: {},
    platform: 'linux', arch: 'x64', dependencies: createDependencies() });
  assert.equal(downloads, 2);
  assert.equal(extracts, 1);
  assert.equal(probes, 1);
  assert.equal(sdk.reused, false);
  assert.equal(sdk.version, version);
  assert.equal(sdk.archiveSha256, checksum);
  assert.equal(sdk.identity.version, version);
  assert.equal(sdk.verificationLevel, 'official-release-sha256-and-executable-version');
  const reused = await ensureManagedGoSdk({ toolingRoot, cwd: root, platform: 'linux', arch: 'x64',
    dependencies: { download: () => { throw new Error('verified cache must not download again'); } } });
  assert.equal(reused.reused, true);
  assert.equal(resolveManagedGoSdk(toolingRoot, { platform: 'linux', arch: 'x64' }).command, sdk.command);
  assert.equal(resolveManagedGoSdk(toolingRoot, { platform: 'win32', arch: 'x64' }), null, 'cache target mismatch is not accepted');
  if (process.platform === 'linux' && process.arch === 'x64') {
    assert.ok(resolveLocalToolingBinDirs(toolingRoot).includes(sdk.binDir));
    const env = applyToolchainDaemonPolicyEnv({ PATH: '/user/path', GOMAXPROCS: '2', GOFLAGS: '-p=2' },
      { toolingRoot, providerId: 'lsp-gopls', command: '/owned/gopls' });
    assert.equal(env.PATH.split(path.delimiter)[0], sdk.binDir);
    assert.equal(env.GOROOT, sdk.goRoot);
    assert.equal(env.GOMAXPROCS, '2', 'explicit launch limits remain active');
    assert.equal(env.GOFLAGS, '-p=2');
    const unrelated = applyToolchainDaemonPolicyEnv({ PATH: '/user/path' }, { toolingRoot, providerId: 'sourcekit' });
    assert.equal(unrelated.PATH, '/user/path');
    assert.equal(unrelated.GOROOT, undefined);
  }
  assert.equal(isGoToolchainServer({ command: 'gopls' }), true);
  assert.equal(isGoToolchainServer({ providerId: 'lsp-sqls' }), true);
  assert.equal(isGoToolchainServer({ command: 'go-build-wrapper' }), false);
  const standaloneEnv = applyManagedGoEnvironment({}, { toolingRoot, sdk });
  assert.ok(standaloneEnv.GOCACHE.startsWith(toolingRoot));
  assert.ok(standaloneEnv.GOPATH.startsWith(toolingRoot));
  assert.equal((await fs.readdir(path.join(toolingRoot, 'sdk/go'))).some((entry) => entry.startsWith('.install-')), false);

  const beforeExtracts = extracts;
  const beforeProbes = probes;
  const corruptRoot = path.join(root, 'bad-checksum');
  await assert.rejects(ensureManagedGoSdk({ toolingRoot: corruptRoot, cwd: root, platform: 'linux', arch: 'x64',
    dependencies: createDependencies({ download: async (request) => ({ sourceUrl: request.url,
      body: request.url === GO_RELEASE_INDEX_URL ? Buffer.from(JSON.stringify(releases)) : Buffer.from('bad') }) }) }),
  (error) => error.reason === 'go_sdk_checksum_mismatch');
  assert.equal(extracts, beforeExtracts, 'checksum rejection precedes extraction');
  assert.equal(probes, beforeProbes, 'checksum rejection precedes any launch');
  assert.deepEqual(await fs.readdir(path.join(corruptRoot, 'sdk/go')), []);

  const probeRoot = path.join(root, 'bad-probe');
  await assert.rejects(ensureManagedGoSdk({ toolingRoot: probeRoot, cwd: root, platform: 'linux', arch: 'x64',
    dependencies: createDependencies({ probe: async () => ({ ok: true, stdout: 'go version go1.26.8 linux/amd64' }) }) }),
  (error) => error.reason === 'go_sdk_probe_failed');
  assert.deepEqual(await fs.readdir(path.join(probeRoot, 'sdk/go')), []);
  const runtimeMarker = path.join(sdk.goRoot, 'src/runtime/runtime.go');
  await fs.rm(runtimeMarker);
  assert.equal(resolveManagedGoSdk(toolingRoot, { platform: 'linux', arch: 'x64' }), null,
    'a remaining go binary alone is not a reusable SDK layout');
  await fs.writeFile(runtimeMarker, bytes);
  assert.ok(resolveManagedGoSdk(toolingRoot, { platform: 'linux', arch: 'x64' }));
  await fs.writeFile(sdk.command, Buffer.from('changed SDK artifact'));
  assert.equal(resolveManagedGoSdk(toolingRoot, { platform: 'linux', arch: 'x64' }), null);
  await assert.rejects(ensureManagedGoSdk({ toolingRoot, cwd: root, platform: 'linux', arch: 'x64',
    dependencies: { download: () => { throw new Error('unverified cache must be preserved'); } } }),
  (error) => error.reason === 'go_sdk_cache_unverified');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
console.log('Portable Go SDK recipe verifies provenance/layout/identity, reuses its cache and retains explicit failures; all launches/downloads are inert fixtures.');
