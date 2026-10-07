import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  GO_ARCHIVE_ORIGIN, GO_RELEASE_INDEX_URL, applyManagedGoEnvironment,
  hashManagedGoFile, readManagedGoText, resolveGoSdkTarget, resolveManagedGoSdk
} from '../../src/shared/managed-go.js';
import { extractArchive } from '../shared/archive-extraction.js';
import { computeSha256, createInstallError, downloadToBuffer } from './install-shared.js';
import { verifyInstallerRequirementProbe } from './install-requirements.js';

export const GO_SDK_ARCHIVE_LIMITS = Object.freeze({
  maxBytes: 512 * 1024 * 1024, maxEntryBytes: 64 * 1024 * 1024, maxEntries: 50_000
});
const MAX_DOWNLOAD_BYTES = 128 * 1024 * 1024;

export const selectOfficialGoSdkArchive = (releases, target, version = '') => {
  if (!target) throw createInstallError('go_sdk_unsupported_target', 'No portable Go SDK recipe for this platform/architecture.');
  const release = (Array.isArray(releases) ? releases : []).find((entry) => entry?.stable === true
    && /^go\d+\.\d+\.\d+$/.test(entry.version) && (!version || entry.version === version));
  if (!release) throw createInstallError('go_sdk_release_unavailable', 'The official index does not contain the requested stable Go SDK.');
  const filename = `${release.version}.${target.os}-${target.arch}.${target.archiveType}`;
  const file = (Array.isArray(release.files) ? release.files : []).find((entry) => entry?.filename === filename && entry.kind === 'archive'
    && entry.os === target.os && entry.arch === target.arch && entry.version === release.version);
  if (!file || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.size)
    || file.size <= 0 || file.size > MAX_DOWNLOAD_BYTES) {
    throw createInstallError('go_sdk_archive_unavailable', 'The official Go SDK archive metadata is missing or outside the supported limits.');
  }
  return { version: release.version, ...target, filename, sha256: file.sha256, size: file.size,
    sourceUrl: `${GO_ARCHIVE_ORIGIN}${filename}`, indexUrl: GO_RELEASE_INDEX_URL };
};

const ensureChildDirectory = async (parent, name) => {
  const child = path.join(parent, name);
  await fs.mkdir(child, { recursive: false }).catch((error) => { if (error.code !== 'EEXIST') throw error; });
  const stat = await fs.lstat(child);
  const physicalParent = await fs.realpath(parent);
  const physicalChild = await fs.realpath(child);
  if (!stat.isDirectory() || path.dirname(physicalChild) !== physicalParent) {
    throw createInstallError('go_sdk_cache_path_invalid', 'Managed Go SDK cache directories must stay inside their selected owner.');
  }
  return child;
};

const probeInstalledSdk = (command, { cwd, env }) => {
  const result = spawnSync(command, ['version'], { cwd, env, encoding: 'utf8',
    timeout: 10_000, maxBuffer: 64 * 1024, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
  return { ok: result.status === 0 && !result.signal && !result.error,
    status: result.status, signal: result.signal || null, stdout: result.stdout || '' };
};

const checkSdkLayout = async (goRoot, archive) => {
  const executable = archive.os === 'windows' ? '.exe' : '';
  const expectedFiles = ['VERSION', `bin/go${executable}`, `bin/gofmt${executable}`, 'src/runtime/runtime.go'];
  for (const relative of expectedFiles) {
    const stat = await fs.lstat(path.join(goRoot, relative));
    if (!stat.isFile() || stat.size <= 0 || stat.size > (relative === 'VERSION' ? 4096 : GO_SDK_ARCHIVE_LIMITS.maxEntryBytes)) {
      throw createInstallError('go_sdk_layout_invalid', `Go SDK is missing a regular ${relative} file.`);
    }
  }
  const version = readManagedGoText(path.join(goRoot, 'VERSION'), 4096);
  if (version?.split('\n')[0].trim() !== archive.version) {
    throw createInstallError('go_sdk_version_mismatch', 'Go SDK VERSION disagrees with its official archive metadata.');
  }
  const toolsDir = path.join(goRoot, 'pkg', 'tool', `${archive.os}_${archive.arch}`);
  const tools = await fs.readdir(toolsDir, { withFileTypes: true });
  if (!tools.length || tools.some((entry) => !entry.isFile())) {
    throw createInstallError('go_sdk_layout_invalid', 'Go SDK compiler tool directory is missing or contains unsupported entries.');
  }
  if (archive.os !== 'windows') {
    // The shared archive reader intentionally strips executable permissions.
    // Restore them only on the official SDK's known executable directories.
    for (const relative of ['bin/go', 'bin/gofmt', ...tools.map((entry) => `pkg/tool/${archive.os}_${archive.arch}/${entry.name}`)]) {
      await fs.chmod(path.join(goRoot, relative), 0o755);
    }
  }
  return path.join(goRoot, `bin/go${executable}`);
};

/**
 * Install one official portable SDK into an application-owned shared cache.
 * No fetched checkout scripts, package-manager elevation or global PATH writes.
 * Dependencies support inert fixtures; production URLs and provenance are fixed.
 */
export const ensureManagedGoSdk = async ({ toolingRoot, cwd, baseEnv = process.env,
  platform = process.platform, arch = process.arch, version = '', timeoutMs = 120_000,
  dependencies = {} } = {}) => {
  const target = resolveGoSdkTarget({ platform, arch });
  if (!target) throw createInstallError('go_sdk_unsupported_target', 'No portable Go SDK recipe for this platform/architecture.');
  if (!toolingRoot || !path.isAbsolute(toolingRoot)) {
    throw createInstallError('go_sdk_cache_path_invalid', 'Managed Go SDK installation requires an absolute tooling directory.');
  }
  const cached = resolveManagedGoSdk(toolingRoot, { platform, arch });
  if (cached && (!version || cached.version === version)) return { ...cached, reused: true };
  await fs.mkdir(toolingRoot, { recursive: true });
  const sdkParent = await ensureChildDirectory(toolingRoot, 'sdk');
  const cache = await ensureChildDirectory(sdkParent, 'go');
  const pointer = path.join(cache, 'current.json');
  const pointerStat = await fs.lstat(pointer).catch((error) => { if (error.code !== 'ENOENT') throw error; return null; });
  if (pointerStat && !cached) {
    throw createInstallError('go_sdk_cache_unverified', 'Existing Go SDK cache is unverified; it was preserved instead of overwritten.');
  }
  const download = dependencies.download || downloadToBuffer;
  const index = await download({ url: GO_RELEASE_INDEX_URL, label: 'official Go release index',
    timeoutMs, maxBytes: 2 * 1024 * 1024, redirect: 'error' });
  if (index.sourceUrl !== GO_RELEASE_INDEX_URL) throw createInstallError('go_sdk_source_mismatch', 'Go release index changed origin.');
  const archive = selectOfficialGoSdkArchive(JSON.parse(index.body.toString('utf8')), target, version);
  const packageKey = `${archive.version}-${target.os}-${target.arch}`;
  const destination = path.join(cache, packageKey);
  if (await fs.lstat(destination).then(() => true, (error) => { if (error.code !== 'ENOENT') throw error; return false; })) {
    throw createInstallError('go_sdk_cache_conflict', 'The requested SDK cache slot already exists without a reusable receipt; it was preserved.');
  }
  const transaction = await fs.mkdtemp(path.join(cache, '.install-'));
  const transactionIdentity = await fs.lstat(transaction);
  let pointerTemp = null;
  try {
    const fetched = await download({ url: archive.sourceUrl, label: 'official Go SDK archive',
      timeoutMs, maxBytes: MAX_DOWNLOAD_BYTES, redirect: 'error' });
    if (fetched.sourceUrl !== archive.sourceUrl || fetched.body.length !== archive.size
      || computeSha256(fetched.body) !== archive.sha256) {
      throw createInstallError('go_sdk_checksum_mismatch', 'Go SDK bytes disagree with official size/source/SHA256 metadata.');
    }
    const archivePath = path.join(transaction, archive.filename);
    await fs.writeFile(archivePath, fetched.body, { flag: 'wx' });
    const extracted = path.join(transaction, 'extracted');
    await (dependencies.extract || extractArchive)(archivePath, extracted, archive.archiveType, GO_SDK_ARCHIVE_LIMITS);
    const goRoot = path.join(extracted, 'go');
    if (!(await fs.lstat(goRoot)).isDirectory() || await fs.realpath(goRoot) !== path.join(await fs.realpath(extracted), 'go')) {
      throw createInstallError('go_sdk_layout_invalid', 'Go SDK root must be an owned extracted directory.');
    }
    const command = await checkSdkLayout(goRoot, archive);
    const sdk = { goRoot, binDir: path.join(goRoot, 'bin') };
    const env = applyManagedGoEnvironment(baseEnv, { toolingRoot, sdk });
    env.GOENV = 'off';
    env.GOWORK = 'off';
    const probe = await (dependencies.probe || probeInstalledSdk)(command, { cwd: cwd || transaction, env });
    const verification = verifyInstallerRequirementProbe('go', probe);
    if (!verification.ok || verification.identity.version !== archive.version
      || verification.identity.platform !== target.os || verification.identity.arch !== target.arch) {
      throw createInstallError('go_sdk_probe_failed', 'The installed Go SDK did not report the expected version/platform/architecture.');
    }
    const receipt = { schemaVersion: 1, packageKey, version: archive.version, os: target.os, arch: target.arch,
      filename: archive.filename, indexUrl: archive.indexUrl, sourceUrl: archive.sourceUrl,
      archiveSha256: archive.sha256, archiveBytes: archive.size, goBinarySha256: hashManagedGoFile(command),
      identity: verification.identity, verificationLevel: 'official-release-sha256-and-executable-version',
      installedAt: new Date().toISOString() };
    await fs.writeFile(path.join(extracted, 'installation.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
    await fs.rename(extracted, destination);
    pointerTemp = path.join(cache, `.current-${randomUUID()}.json`);
    await fs.writeFile(pointerTemp, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
    const nowPointer = await fs.lstat(pointer).catch((error) => { if (error.code !== 'ENOENT') throw error; return null; });
    if ((pointerStat == null) !== (nowPointer == null) || (pointerStat &&
      (!nowPointer.isFile() || nowPointer.dev !== pointerStat.dev || nowPointer.ino !== pointerStat.ino))) {
      throw createInstallError('go_sdk_cache_changed', 'Go SDK active receipt changed during installation; the new SDK is retained without activation.');
    }
    await fs.rename(pointerTemp, pointer);
    pointerTemp = null;
    const installed = resolveManagedGoSdk(toolingRoot, { platform, arch });
    if (!installed) throw createInstallError('go_sdk_cache_verification_failed', 'Published SDK receipt could not be verified.');
    return { ...installed, reused: false };
  } finally {
    if (pointerTemp) await fs.rm(pointerTemp, { force: true });
    const current = await fs.lstat(transaction).catch(() => null);
    if (current?.isDirectory() && current.dev === transactionIdentity.dev && current.ino === transactionIdentity.ino) {
      await fs.rm(transaction, { recursive: true, force: true });
    }
  }
};
