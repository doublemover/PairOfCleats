import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  CLANGD_ARCHIVE_LIMITS, CLANGD_MAX_DOWNLOAD_BYTES, CLANGD_STORAGE_ESTIMATE,
  CLANGD_MAX_BINARY_BYTES, CLANGD_RELEASE_INDEX_URL, hasClangdTargetHeader,
  resolveClangdArchiveTarget, resolveManagedClangd
} from '../../src/shared/managed-clangd.js';
import { hashManagedToolFile } from '../../src/shared/managed-tool-file.js';
import { isDirectExecution } from '../../src/shared/direct-execution.js';
import { extractArchive, runArchiveTransaction } from '../shared/archive-extraction.js';
import { computeSha256, createInstallError } from './install-shared.js';
import { downloadOfficialGitHubRelease } from './official-release-download.js';
import { runInstallWithStorageAdmission } from './install-storage.js';
import { probeProvisioningCommand } from './provisioning-plan.js';
import { verifyOwnedResource } from './managed-verification.js';
import { assertNoSymlinkPath } from '../../src/shared/contained-file.js';
import { observeStorageResource } from '../../src/shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../src/shared/storage/operation-error.js';

export { CLANGD_ARCHIVE_LIMITS };

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
    || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > CLANGD_MAX_DOWNLOAD_BYTES) {
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

export const probeInstalledClangd = async (command, { cwd, env, signal, resourceId }, dependencies = {}) => {
  try {
    const result = await probeProvisioningCommand(command, ['--version'], { cwd, env, signal,
      timeoutMs: 10_000, maxOutputBytes: 64 * 1024, stdio: 'pipe', ...dependencies });
    return { ...result, settlement: { resourceId, settled: true, pending: false } };
  } catch (error) {
    // The shared probe owns child/tree settlement on both result and error.
    // Cancellation after a confirmed close must not invent a pending child.
    observeStorageResource(error, { phase: 'clangd-version-probe' }).requireSettled();
    throw addStorageFailureContext(error, { settlement: { resourceId, settled: true, pending: false } });
  }
};

/** Preserve the whole vendor package, including its builtin C/C++ headers. */
const ensureManagedClangdOwned = async ({ toolingRoot, cwd, baseEnv = process.env, signal = null,
  platform = process.platform, arch = process.arch, timeoutMs = 120_000, dependencies = {} } = {}) => {
  signal?.throwIfAborted();
  const target = resolveClangdArchiveTarget({ platform, arch });
  if (!target) throw createInstallError('clangd_unsupported_target', 'No standalone clangd recipe for this platform/architecture.');
  if (!toolingRoot || !path.isAbsolute(toolingRoot)) throw createInstallError('clangd_cache_path_invalid', 'clangd needs an absolute tooling root.');
  const cached = resolveManagedClangd(toolingRoot, { platform, arch });
  if (cached) return { ...cached, reused: true };
  assertNoSymlinkPath(path.parse(toolingRoot).root, toolingRoot, { allowMissing: true });
  await fs.mkdir(toolingRoot, { recursive: true });
  const servers = await ensureChild(toolingRoot, 'servers');
  const cache = await ensureChild(servers, 'clangd');
  const pointer = path.join(cache, 'current.json');
  if (await fs.lstat(pointer).then(() => true, (error) => { if (error.code !== 'ENOENT') throw error; return false; })) {
    throw createInstallError('clangd_cache_unverified', 'Unverified clangd cache was preserved instead of overwritten.');
  }
  const download = dependencies.download || downloadOfficialGitHubRelease;
  const metadata = await download({ url: CLANGD_RELEASE_INDEX_URL, maxBytes: 2 * 1024 * 1024, timeoutMs, signal });
  signal?.throwIfAborted();
  if (metadata.sourceUrl !== CLANGD_RELEASE_INDEX_URL) throw createInstallError('clangd_source_mismatch', 'clangd metadata changed source.');
  const archive = selectOfficialClangdArchive(JSON.parse(metadata.body.toString('utf8')), target);
  const packageKey = `${archive.version}-${platform}-${arch}`;
  const destination = path.join(cache, packageKey);
  if (await fs.lstat(destination).then(() => true, (error) => { if (error.code !== 'ENOENT') throw error; return false; })) {
    throw createInstallError('clangd_cache_conflict', 'clangd package cache slot already exists without a reusable receipt.');
  }
  const transaction = await fs.mkdtemp(path.join(cache, '.install-'));
  const identity = await fs.lstat(transaction, { bigint: true });
  let pointerTemp = null, pointerTempIdentity = null;
  return runArchiveTransaction(transaction, identity, async () => {
    const fetched = await download({ url: archive.sourceUrl, maxBytes: CLANGD_MAX_DOWNLOAD_BYTES, timeoutMs, signal });
    signal?.throwIfAborted();
    if (fetched.sourceUrl !== archive.sourceUrl || fetched.body.length !== archive.size || computeSha256(fetched.body) !== archive.sha256) {
      throw createInstallError('clangd_checksum_mismatch', 'clangd archive bytes disagree with the official digest/size/source.');
    }
    const archivePath = path.join(transaction, archive.filename);
    await fs.writeFile(archivePath, fetched.body, { flag: 'wx' });
    const extracted = path.join(transaction, 'extracted');
    await (dependencies.extract || extractArchive)(archivePath, extracted, 'zip', CLANGD_ARCHIVE_LIMITS);
    signal?.throwIfAborted();
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
    const temporary = await ensureChild(transaction, 'probe-temp');
    const env = { ...baseEnv, TMP: temporary, TEMP: temporary, TMPDIR: temporary };
    const probe = await verifyOwnedResource(input => (dependencies.probe || probeInstalledClangd)(command, input),
      { cwd: cwd || transaction, env, signal }, randomUUID());
    signal?.throwIfAborted();
    const matched = /^clangd version (\d+\.\d+\.\d+)(?:\s|$)/m.exec(String(probe?.stdout || ''));
    if (probe?.ok !== true || matched?.[1] !== archive.version) {
      throw createInstallError('clangd_probe_failed', 'clangd did not report the expected release version.');
    }
    const receipt = { schemaVersion: 1, family: 'clangd', version: archive.version, platform, arch,
      packageKey, filename: archive.filename, indexUrl: CLANGD_RELEASE_INDEX_URL, sourceUrl: archive.sourceUrl,
      archiveSha256: archive.sha256, archiveBytes: archive.size, binarySha256: hashManagedToolFile(command, CLANGD_MAX_BINARY_BYTES),
      verificationLevel: 'official-release-sha256-binary-target-and-executable-version', installedAt: new Date().toISOString() };
    await fs.writeFile(path.join(extracted, 'installation.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
    signal?.throwIfAborted();
    await fs.rename(extracted, destination);
    pointerTemp = path.join(cache, `.current-${randomUUID()}.json`);
    await fs.writeFile(pointerTemp, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
    pointerTempIdentity = await fs.lstat(pointerTemp, { bigint: true });
    // Link publishes only if no concurrent writer has already chosen a package.
    await fs.link(pointerTemp, pointer);
    await fs.rm(pointerTemp);
    pointerTemp = null;
    const installed = resolveManagedClangd(toolingRoot, { platform, arch });
    if (!installed) throw createInstallError('clangd_cache_verification_failed', 'clangd installed receipt could not be verified.');
    return { ...installed, reused: false };
  }, async () => {
    if (!pointerTemp) return;
    const current = await fs.lstat(pointerTemp, { bigint: true }).catch(value => { if (value?.code === 'ENOENT') return null; throw value; });
    if (!current) return;
    if (!pointerTempIdentity || !current.isFile() || current.isSymbolicLink()
      || current.dev !== pointerTempIdentity.dev || current.ino !== pointerTempIdentity.ino) {
      throw new Error('Clangd private pointer identity changed; unknown evidence is preserved.');
    }
    await fs.rm(pointerTemp, { force: false });
    pointerTemp = null;
  });
};

/** One canonical acquisition owner: callers do not wrap this in a package-child
 * reservation. A verified cache reuse performs no acquisition or reservation. */
export const ensureManagedClangd = async (options = {}) => {
  options.signal?.throwIfAborted();
  const target = { platform: options.platform || process.platform, arch: options.arch || process.arch };
  if (!resolveClangdArchiveTarget(target)) throw createInstallError('clangd_unsupported_target', 'No standalone clangd recipe for this platform/architecture.');
  if (!options.toolingRoot || !path.isAbsolute(options.toolingRoot)) throw createInstallError('clangd_cache_path_invalid', 'clangd needs an absolute tooling root.');
  const cached = resolveManagedClangd(options.toolingRoot, target);
  if (cached) return { ...cached, reused: true };
  const baseEnv = Object.freeze({ ...(options.baseEnv || process.env) });
  const publication = await runInstallWithStorageAdmission({ toolingRoot: options.toolingRoot,
    storageEstimate: CLANGD_STORAGE_ESTIMATE, scope: 'managed-clangd-publication' },
  () => ensureManagedClangdOwned({ ...options, ...target, baseEnv }));
  return publication.value;
};

if (isDirectExecution(import.meta.url)) {
  const { createCli } = await import('../../src/shared/cli.js');
  const argv = createCli({ scriptName: 'install-clangd', options: {
    'tooling-root': { type: 'string', required: true }, scope: { type: 'string', default: 'cache' }
  } }).strictOptions().parse();
  const controller = new AbortController();
  let interrupted = null;
  const interrupt = () => { interrupted = 130; controller.abort(new Error('clangd installation interrupted.')); };
  const terminate = () => { interrupted = 143; controller.abort(new Error('clangd installation terminated.')); };
  process.once('SIGINT', interrupt); process.once('SIGTERM', terminate);
  try {
    if (argv.scope !== 'cache') throw createInstallError('clangd_scope_unsupported', 'Only the managed cache scope is supported.');
    const installed = await ensureManagedClangd({ toolingRoot: path.resolve(argv['tooling-root']), cwd: process.cwd(), signal: controller.signal });
    console.error(`[clangd-install] ${installed.version} ${installed.platform}/${installed.arch} ${installed.reused ? 'reused' : 'installed'}.`);
  } catch (error) {
    console.error(`[clangd-install] ${error.reason || 'failed'}: ${error.message}`);
    process.exitCode = interrupted || 1;
  } finally {
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate);
  }
}
