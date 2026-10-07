import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  CLANGD_MAX_BINARY_BYTES, CLANGD_RELEASE_INDEX_URL, hasClangdTargetHeader,
  resolveClangdArchiveTarget, resolveManagedClangd
} from '../../src/shared/managed-clangd.js';
import { hashManagedToolFile } from '../../src/shared/managed-tool-file.js';
import { isDirectExecution } from '../../src/shared/direct-execution.js';
import { extractArchive } from '../shared/archive-extraction.js';
import { computeSha256, createInstallError } from './install-shared.js';
import { downloadOfficialGitHubRelease } from './official-release-download.js';

export const CLANGD_ARCHIVE_LIMITS = Object.freeze({
  maxBytes: 768 * 1024 * 1024, maxEntryBytes: CLANGD_MAX_BINARY_BYTES, maxEntries: 20_000
});
const MAX_DOWNLOAD_BYTES = 128 * 1024 * 1024;

export const selectOfficialClangdArchive = (release, target) => {
  const version = release?.tag_name;
  if (!target) throw createInstallError('clangd_unsupported_target', 'No standalone clangd recipe for this platform/architecture.');
  if (release?.draft !== false || release?.prerelease !== false || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw createInstallError('clangd_release_unverified', 'clangd installation requires a stable official release.');
  }
  const filename = `clangd-${target.assetPlatform}-${version}.zip`;
  const sourceUrl = `https://github.com/clangd/clangd/releases/download/${version}/${filename}`;
  const asset = (Array.isArray(release.assets) ? release.assets : []).find((entry) => entry?.name === filename);
  if (!asset || asset.browser_download_url !== sourceUrl || !/^sha256:[a-f0-9]{64}$/.test(asset.digest)
    || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_DOWNLOAD_BYTES) {
    throw createInstallError('clangd_asset_unverified', 'Official clangd archive is missing a usable published digest/size/source.');
  }
  return { ...target, version, filename, sourceUrl, sha256: asset.digest.slice(7), size: asset.size };
};

const ensureChild = async (parent, name) => {
  const child = path.join(parent, name);
  await fs.mkdir(child).catch((error) => { if (error.code !== 'EEXIST') throw error; });
  if (!(await fs.lstat(child)).isDirectory() || path.dirname(await fs.realpath(child)) !== await fs.realpath(parent)) {
    throw createInstallError('clangd_cache_path_invalid', 'clangd cache must remain inside its selected owner.');
  }
  return child;
};

const defaultProbe = (command, { cwd }) => {
  const result = spawnSync(command, ['--version'], { cwd, shell: false, encoding: 'utf8',
    timeout: 10_000, maxBuffer: 64 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  return { ok: result.status === 0 && !result.signal && !result.error, stdout: result.stdout || '' };
};

/** Preserve the whole vendor package, including its builtin C/C++ headers. */
export const ensureManagedClangd = async ({ toolingRoot, cwd,
  platform = process.platform, arch = process.arch, timeoutMs = 120_000, dependencies = {} } = {}) => {
  const target = resolveClangdArchiveTarget({ platform, arch });
  if (!target) throw createInstallError('clangd_unsupported_target', 'No standalone clangd recipe for this platform/architecture.');
  if (!toolingRoot || !path.isAbsolute(toolingRoot)) throw createInstallError('clangd_cache_path_invalid', 'clangd needs an absolute tooling root.');
  const cached = resolveManagedClangd(toolingRoot, { platform, arch });
  if (cached) return { ...cached, reused: true };
  await fs.mkdir(toolingRoot, { recursive: true });
  const servers = await ensureChild(toolingRoot, 'servers');
  const cache = await ensureChild(servers, 'clangd');
  const pointer = path.join(cache, 'current.json');
  if (await fs.lstat(pointer).then(() => true, (error) => { if (error.code !== 'ENOENT') throw error; return false; })) {
    throw createInstallError('clangd_cache_unverified', 'Unverified clangd cache was preserved instead of overwritten.');
  }
  const download = dependencies.download || downloadOfficialGitHubRelease;
  const metadata = await download({ url: CLANGD_RELEASE_INDEX_URL, maxBytes: 2 * 1024 * 1024, timeoutMs });
  if (metadata.sourceUrl !== CLANGD_RELEASE_INDEX_URL) throw createInstallError('clangd_source_mismatch', 'clangd metadata changed source.');
  const archive = selectOfficialClangdArchive(JSON.parse(metadata.body.toString('utf8')), target);
  const packageKey = `${archive.version}-${platform}-${arch}`;
  const destination = path.join(cache, packageKey);
  if (await fs.lstat(destination).then(() => true, (error) => { if (error.code !== 'ENOENT') throw error; return false; })) {
    throw createInstallError('clangd_cache_conflict', 'clangd package cache slot already exists without a reusable receipt.');
  }
  const transaction = await fs.mkdtemp(path.join(cache, '.install-'));
  const identity = await fs.lstat(transaction);
  let pointerTemp = null;
  try {
    const fetched = await download({ url: archive.sourceUrl, maxBytes: MAX_DOWNLOAD_BYTES, timeoutMs });
    if (fetched.sourceUrl !== archive.sourceUrl || fetched.body.length !== archive.size || computeSha256(fetched.body) !== archive.sha256) {
      throw createInstallError('clangd_checksum_mismatch', 'clangd archive bytes disagree with the official digest/size/source.');
    }
    const archivePath = path.join(transaction, archive.filename);
    await fs.writeFile(archivePath, fetched.body, { flag: 'wx' });
    const extracted = path.join(transaction, 'extracted');
    await (dependencies.extract || extractArchive)(archivePath, extracted, 'zip', CLANGD_ARCHIVE_LIMITS);
    const packageRoot = path.join(extracted, `clangd_${archive.version}`);
    if (!(await fs.lstat(packageRoot)).isDirectory() || await fs.realpath(packageRoot) !== path.join(await fs.realpath(extracted), `clangd_${archive.version}`)) {
      throw createInstallError('clangd_layout_invalid', 'clangd package root is missing or unsupported.');
    }
    const command = path.join(packageRoot, 'bin', platform === 'win32' ? 'clangd.exe' : 'clangd');
    if (!(await fs.lstat(command)).isFile() || !hasClangdTargetHeader(command, target)) {
      throw createInstallError('clangd_target_mismatch', 'clangd binary header does not support this platform/architecture.');
    }
    const resourceDir = path.join(packageRoot, 'lib', 'clang', archive.version.split('.')[0], 'include');
    if (!(await fs.lstat(resourceDir)).isDirectory() || !(await fs.readdir(resourceDir)).length) {
      throw createInstallError('clangd_resources_missing', 'clangd builtin header resources are missing.');
    }
    if (platform !== 'win32') await fs.chmod(command, 0o755);
    const probe = await (dependencies.probe || defaultProbe)(command, { cwd: cwd || transaction });
    const matched = /^clangd version (\d+\.\d+\.\d+)(?:\s|$)/m.exec(String(probe?.stdout || ''));
    if (probe?.ok !== true || matched?.[1] !== archive.version) {
      throw createInstallError('clangd_probe_failed', 'clangd did not report the expected release version.');
    }
    const receipt = { schemaVersion: 1, family: 'clangd', version: archive.version, platform, arch,
      packageKey, filename: archive.filename, indexUrl: CLANGD_RELEASE_INDEX_URL, sourceUrl: archive.sourceUrl,
      archiveSha256: archive.sha256, archiveBytes: archive.size, binarySha256: hashManagedToolFile(command, CLANGD_MAX_BINARY_BYTES),
      verificationLevel: 'official-release-sha256-binary-target-and-executable-version', installedAt: new Date().toISOString() };
    await fs.writeFile(path.join(extracted, 'installation.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
    await fs.rename(extracted, destination);
    pointerTemp = path.join(cache, `.current-${randomUUID()}.json`);
    await fs.writeFile(pointerTemp, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
    // Link publishes only if no concurrent writer has already chosen a package.
    await fs.link(pointerTemp, pointer);
    await fs.rm(pointerTemp);
    pointerTemp = null;
    const installed = resolveManagedClangd(toolingRoot, { platform, arch });
    if (!installed) throw createInstallError('clangd_cache_verification_failed', 'clangd installed receipt could not be verified.');
    return { ...installed, reused: false };
  } finally {
    if (pointerTemp) await fs.rm(pointerTemp, { force: true });
    const current = await fs.lstat(transaction).catch(() => null);
    if (current?.isDirectory() && current.dev === identity.dev && current.ino === identity.ino) await fs.rm(transaction, { recursive: true, force: true });
  }
};

if (isDirectExecution(import.meta.url)) {
  const { createCli } = await import('../../src/shared/cli.js');
  const argv = createCli({ scriptName: 'install-clangd', options: {
    'tooling-root': { type: 'string', required: true }, scope: { type: 'string', default: 'cache' }
  } }).strictOptions().parse();
  try {
    if (argv.scope !== 'cache') throw createInstallError('clangd_scope_unsupported', 'Only the managed cache scope is supported.');
    const installed = await ensureManagedClangd({ toolingRoot: path.resolve(argv['tooling-root']), cwd: process.cwd() });
    console.error(`[clangd-install] ${installed.version} ${installed.platform}/${installed.arch} ${installed.reused ? 'reused' : 'installed'}.`);
  } catch (error) {
    console.error(`[clangd-install] ${error.reason || 'failed'}: ${error.message}`);
    process.exitCode = 1;
  }
}
