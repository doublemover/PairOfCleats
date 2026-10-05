#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ensureManagedClangd, selectOfficialClangdArchive } from '../../../tools/tooling/install-clangd.js';
import {
  CLANGD_RELEASE_INDEX_URL, hasClangdTargetHeader, resolveClangdArchiveTarget, resolveManagedClangd
} from '../../../src/shared/managed-clangd.js';
import { downloadOfficialGitHubRelease } from '../../../tools/tooling/official-release-download.js';
import { resolveLocalToolingBinDirs } from '../../../src/shared/tooling-bin-dirs.js';

process.env.PAIROFCLEATS_TESTING = '1';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-clangd-recipe-'));
const version = '23.1.0';
const archiveBytes = Buffer.from('inert clangd archive fixture');
const checksum = createHash('sha256').update(archiveBytes).digest('hex');
const releaseFor = (target) => {
  const name = `clangd-${target.assetPlatform}-${version}.zip`;
  return { tag_name: version, draft: false, prerelease: false, assets: [{ name,
    browser_download_url: `https://github.com/clangd/clangd/releases/download/${version}/${name}`,
    digest: `sha256:${checksum}`, size: archiveBytes.length }] };
};
const binaryFor = (target) => {
  const bytes = Buffer.alloc(128);
  if (target.platform === 'linux') {
    bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
    bytes.writeUInt16LE(0x3e, 18);
  } else if (target.platform === 'win32') {
    bytes.writeUInt16LE(0x5a4d, 0);
    bytes.writeUInt32LE(64, 0x3c);
    bytes.writeUInt32LE(0x4550, 64);
    bytes.writeUInt16LE(0x8664, 68);
  } else {
    bytes.writeUInt32BE(0xcafebabe, 0);
    bytes.writeUInt32BE(2, 4);
    bytes.writeUInt32BE(0x01000007, 8);
    bytes.writeUInt32BE(0x0100000c, 28);
  }
  return bytes;
};
let downloads = 0;
let extracts = 0;
let probes = 0;
let linuxDependencies = null;

try {
  assert.equal(resolveClangdArchiveTarget({ platform: 'linux', arch: 'arm64' }), null);
  assert.equal(resolveClangdArchiveTarget({ platform: 'win32', arch: 'ia32' }), null);
  for (const [platform, arch] of [['linux', 'x64'], ['win32', 'x64'], ['darwin', 'x64'], ['darwin', 'arm64']]) {
    const target = resolveClangdArchiveTarget({ platform, arch });
    const release = releaseFor(target);
    assert.equal(selectOfficialClangdArchive(release, target).version, version);
    const incomplete = structuredClone(release);
    incomplete.assets[0].digest = null;
    assert.throws(() => selectOfficialClangdArchive(incomplete, target), /published digest/);
    const toolingRoot = path.join(root, `${platform}-${arch}`);
    const dependencies = {
      download: async ({ url, maxBytes }) => {
        downloads += 1;
        assert.ok(maxBytes > 0);
        if (url === CLANGD_RELEASE_INDEX_URL) return { sourceUrl: url, body: Buffer.from(JSON.stringify(release)) };
        assert.equal(url, release.assets[0].browser_download_url);
        return { sourceUrl: url, body: archiveBytes };
      },
      extract: async (_archive, destination, type) => {
        extracts += 1;
        assert.equal(type, 'zip');
        const packageRoot = path.join(destination, `clangd_${version}`);
        const binary = path.join(packageRoot, 'bin', platform === 'win32' ? 'clangd.exe' : 'clangd');
        await fs.mkdir(path.dirname(binary), { recursive: true });
        await fs.writeFile(binary, binaryFor(target));
        const header = path.join(packageRoot, 'lib/clang/23/include/stddef.h');
        await fs.mkdir(path.dirname(header), { recursive: true });
        await fs.writeFile(header, 'inert builtin header fixture');
      },
      probe: async (command, options) => {
        probes += 1;
        assert.equal(options.cwd, root);
        assert.ok(command.endsWith(platform === 'win32' ? 'clangd.exe' : 'clangd'));
        return { ok: true, stdout: `clangd version ${version}\n` };
      }
    };
    if (platform === 'linux') linuxDependencies = dependencies;
    const installed = await ensureManagedClangd({ toolingRoot, cwd: root, platform, arch, dependencies });
    assert.equal(installed.reused, false);
    assert.equal(installed.archiveSha256, checksum);
    assert.equal(installed.platform, platform);
    assert.equal(installed.arch, arch);
    assert.ok((await fs.readFile(path.join(installed.resourceDir, 'stddef.h'), 'utf8')).includes('inert'));
    assert.equal(hasClangdTargetHeader(installed.command, target), true);
    const reused = await ensureManagedClangd({ toolingRoot, cwd: root, platform, arch,
      dependencies: { download: () => { throw new Error('verified cache must not download again'); } } });
    assert.equal(reused.reused, true);
    assert.equal(resolveManagedClangd(toolingRoot, { platform, arch }).command, installed.command);
    if (platform === process.platform && arch === process.arch) assert.ok(resolveLocalToolingBinDirs(toolingRoot).includes(installed.binDir));
    await fs.rm(path.join(installed.resourceDir, 'stddef.h'));
    assert.equal(resolveManagedClangd(toolingRoot, { platform, arch }), null, 'empty resource directory invalidates reuse');
    await assert.rejects(ensureManagedClangd({ toolingRoot, cwd: root, platform, arch, dependencies }),
      (error) => error.reason === 'clangd_cache_unverified');
    assert.equal((await fs.readdir(path.join(toolingRoot, 'servers/clangd'))).some((entry) => entry.startsWith('.install-')), false);
  }
  assert.equal(downloads, 8);
  assert.equal(extracts, 4);
  assert.equal(probes, 4);

  const linuxTarget = resolveClangdArchiveTarget({ platform: 'linux', arch: 'x64' });
  const checksumRoot = path.join(root, 'bad-checksum');
  await assert.rejects(ensureManagedClangd({ toolingRoot: checksumRoot, cwd: root, platform: 'linux', arch: 'x64',
    dependencies: { ...linuxDependencies, download: async ({ url }) => ({ sourceUrl: url,
      body: url === CLANGD_RELEASE_INDEX_URL ? Buffer.from(JSON.stringify(releaseFor(linuxTarget))) : Buffer.alloc(archiveBytes.length, 0x42) }) } }),
  (error) => error.reason === 'clangd_checksum_mismatch');
  assert.equal(extracts, 4, 'wrong checksum is rejected before extraction');
  assert.equal(probes, 4, 'wrong checksum is rejected before native launch');
  assert.deepEqual(await fs.readdir(path.join(checksumRoot, 'servers/clangd')), []);
  const wrongTargetRoot = path.join(root, 'bad-target');
  await assert.rejects(ensureManagedClangd({ toolingRoot: wrongTargetRoot, cwd: root, platform: 'linux', arch: 'x64',
    dependencies: { ...linuxDependencies, extract: async (...args) => {
      await linuxDependencies.extract(...args);
      const command = path.join(args[1], `clangd_${version}`, 'bin/clangd');
      const wrong = binaryFor(linuxTarget);
      wrong.writeUInt16LE(0xb7, 18);
      await fs.writeFile(command, wrong);
    } } }), (error) => error.reason === 'clangd_target_mismatch');
  assert.equal(probes, 4, 'wrong binary architecture is rejected before native launch');
  assert.deepEqual(await fs.readdir(path.join(wrongTargetRoot, 'servers/clangd')), []);

  const redirects = [];
  const downloaded = await downloadOfficialGitHubRelease({
    url: 'https://github.com/clangd/clangd/releases/download/23.1.0/inert.zip', maxBytes: 100,
    fetchImpl: async (url, options) => {
      redirects.push(url);
      assert.equal(options.redirect, 'manual');
      assert.deepEqual(Object.keys(options.headers), ['accept']);
      return redirects.length === 1
        ? { status: 302, headers: new Map([['location', 'https://release-assets.githubusercontent.com/inert']]) }
        : { ok: true, status: 200, headers: new Map(), body: [Buffer.from('inert')] };
    }
  });
  assert.equal(downloaded.body.toString(), 'inert');
  assert.equal(redirects.length, 2);
  let badCalls = 0;
  await assert.rejects(downloadOfficialGitHubRelease({ url: 'https://github.com/clangd/clangd/releases/download/inert', maxBytes: 100,
    fetchImpl: async () => { badCalls += 1; return { status: 302, headers: new Map([['location', 'https://example.invalid/inert']]) }; } }),
  (error) => error.reason === 'official_release_origin_rejected');
  assert.equal(badCalls, 1, 'a rejected redirect is never requested');
  await assert.rejects(downloadOfficialGitHubRelease({ url: 'https://github.com/inert', maxBytes: 3,
    fetchImpl: async () => ({ ok: true, status: 200, headers: new Map(), body: [Buffer.from('inert')] }) }),
  (error) => error.reason === 'official_release_too_large');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
console.log('Standalone clangd recipe preserves builtin headers, verifies digests/targets/version and reuses cache; downloads, extraction and launches are inert.');
