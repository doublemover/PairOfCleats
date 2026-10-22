import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnResolvedSubprocess } from '../../src/shared/subprocess/command-invocation.js';
import {
  GO_ARCHIVE_ORIGIN, GO_RELEASE_INDEX_URL, applyManagedGoEnvironment,
  hashManagedGoFile, readManagedGoText, resolveGoSdkTarget, resolveManagedGoSdk
} from '../../src/shared/managed-go.js';
import { extractArchive } from '../shared/archive-extraction.js';
import { computeSha256, createInstallError, downloadToBuffer, settleInstallDownload } from './install-shared.js';
import { verifyInstallerRequirementProbe } from './install-requirements.js';
import { runInstallWithStorageAdmission } from './install-storage.js';
import { addStorageFailureContext } from '../../src/shared/storage/operation-error.js';
import { assertNoSymlinkPath } from '../../src/shared/contained-file.js';
import { verifyOwnedResource, captureManagedVerificationFailure, retainManagedResourceFailure } from './managed-verification.js';

export const GO_SDK_ARCHIVE_LIMITS = Object.freeze({
  maxBytes: 512 * 1024 * 1024, maxEntryBytes: 64 * 1024 * 1024, maxEntries: 50_000
});
const MAX_DOWNLOAD_BYTES = 128 * 1024 * 1024;
const asError = value => value && typeof value === 'object' ? value : new Error(String(value), { cause: value });

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
  if (!stat.isDirectory() || stat.isSymbolicLink() || path.dirname(physicalChild) !== physicalParent) {
    throw createInstallError('go_sdk_cache_path_invalid', 'Managed Go SDK cache directories must stay inside their selected owner.');
  }
  return child;
};

export const probeInstalledSdk = async (command, { cwd, env, signal, resourceId }, { spawn = spawnResolvedSubprocess } = {}) => {
  let spawned = false, closeObserved = false, completed = false;
  try {
    const result = await spawn(command, ['version'], { cwd, env, signal,
      timeoutMs: 10000, outputEncoding: 'utf8', maxOutputBytes: 65536, rejectOnNonZeroExit: false,
      onSpawn: child => { spawned = true; child?.once?.('close', () => { closeObserved = true; }); } });
    completed = true;
    signal?.throwIfAborted();
    return { ok: result.exitCode === 0 && !result.signal && !result.outputCapture?.stdout?.truncated,
      status: result.exitCode, signal: result.signal || null, stdout: result.stdout || '',
      settlement: { resourceId, settled: true, pending: false } };
  } catch (value) {
    const error = asError(value);
    let termination, inspectionError = null;
    try { termination = error.result?.termination; } catch (failure) { inspectionError = asError(failure); }
    const original = captureManagedVerificationFailure(error, resourceId).observe;
    const treeSettled = termination?.treeCleanupSettled === true && termination.treeCleanupFailed === false;
    const closed = () => (completed || !spawned || (closeObserved || termination?.closeObserved === true) && treeSettled
      || original?.() === true) && (!original || original());
    const settled = closed();
    throw addStorageFailureContext(error, settled ? { settlement: { resourceId, settled: true, pending: false } }
      : { cacheOwnershipPending: true, cacheOwnershipReleased: closed }, inspectionError);
  }
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
const ensureManagedGoSdkOwned = async ({ toolingRoot, cwd, baseEnv = process.env,
  platform = process.platform, arch = process.arch, version = '', timeoutMs = 120_000,
  signal = null, dependencies = {} } = {}) => {
  signal?.throwIfAborted();
  const target = resolveGoSdkTarget({ platform, arch });
  if (!target) throw createInstallError('go_sdk_unsupported_target', 'No portable Go SDK recipe for this platform/architecture.');
  if (!toolingRoot || !path.isAbsolute(toolingRoot)) {
    throw createInstallError('go_sdk_cache_path_invalid', 'Managed Go SDK installation requires an absolute tooling directory.');
  }
  const cached = resolveManagedGoSdk(toolingRoot, { platform, arch });
  if (cached && (!version || cached.version === version)) return { ...cached, reused: true };
  assertNoSymlinkPath(path.parse(toolingRoot).root, toolingRoot, { allowMissing: true });
  await fs.mkdir(toolingRoot, { recursive: true });
  const sdkParent = await ensureChildDirectory(toolingRoot, 'sdk');
  const cache = await ensureChildDirectory(sdkParent, 'go');
  const pointer = path.join(cache, 'current.json');
  const pointerStat = await fs.lstat(pointer).catch((error) => { if (error.code !== 'ENOENT') throw error; return null; });
  const pointerHash = pointerStat ? hashManagedGoFile(pointer, 64 * 1024) : null;
  if (pointerStat && !cached) {
    throw createInstallError('go_sdk_cache_unverified', 'Existing Go SDK cache is unverified; it was preserved instead of overwritten.');
  }
  const download = dependencies.download || downloadToBuffer;
  const index = await download({ url: GO_RELEASE_INDEX_URL, label: 'official Go release index',
    timeoutMs, maxBytes: 2 * 1024 * 1024, redirect: 'error', signal });
  if (index.sourceUrl !== GO_RELEASE_INDEX_URL) throw createInstallError('go_sdk_source_mismatch', 'Go release index changed origin.');
  const archive = selectOfficialGoSdkArchive(JSON.parse(index.body.toString('utf8')), target, version);
  const packageKey = `${archive.version}-${target.os}-${target.arch}`;
  const destination = path.join(cache, packageKey);
  if (await fs.lstat(destination).then(() => true, (error) => { if (error.code !== 'ENOENT') throw error; return false; })) {
    throw createInstallError('go_sdk_cache_conflict', 'The requested SDK cache slot already exists without a reusable receipt; it was preserved.');
  }
  const transaction = await fs.mkdtemp(path.join(cache, '.install-'));
  const transactionIdentity = await fs.lstat(transaction, { bigint: true });
  let pointerTemp = null;
  let pointerTempIdentity = null;
  let pendingError = null;
  let operationError = null;
  let cleaned = false, resourcePending = false, reconciling = null, observerOverflow = false;
  const observers = [], observed = new WeakSet(), described = new WeakSet();
  const resourceId = randomUUID();
  const observeFailure = error => {
    if (!error || typeof error !== 'object' || observed.has(error) || described.has(error)) return;
    observed.add(error);
    const captured = captureManagedVerificationFailure(error, resourceId);
    if (captured.observe) {
      if (observers.length < 128) observers.push(captured.observe);
      else observerOverflow = true;
    }
    if (captured.owned || captured.observe && !captured.observe()) resourcePending = true;
  };
  const resourcesSettled = () => !observerOverflow && !resourcePending && observers.every(observe => observe());
  const cleanupTransaction = async () => {
    if (!resourcesSettled()) throw new Error('Actual Go SDK verifier child/tree closure remains pending.');
    if (cleaned) return true;
    if (pointerTemp) {
      const current = await fs.lstat(pointerTemp, { bigint: true }).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (current) {
        if (!pointerTempIdentity || !current.isFile() || current.isSymbolicLink() || current.dev !== pointerTempIdentity.dev
          || current.ino !== pointerTempIdentity.ino) throw new Error('Go SDK private pointer identity changed; unknown evidence is preserved.');
        await fs.rm(pointerTemp, { force: false });
      }
      pointerTemp = null; pointerTempIdentity = null;
    }
    const current = await fs.lstat(transaction, { bigint: true }).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (current) {
      if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== transactionIdentity.dev || current.ino !== transactionIdentity.ino) {
        throw new Error('Go SDK transaction identity changed; unknown evidence is preserved.');
      }
      await fs.rm(transaction, { recursive: true, force: false });
    }
    cleaned = true;
    return true;
  };
  const retainFailure = (primary, cleanupError = null) => {
    const failure = retainManagedResourceFailure(primary, { session: recovery, field: 'goSdkInstallSession', cleanupField: 'goSdkCleanupError',
      released: () => cleaned && resourcesSettled(), cleanupError });
    described.add(failure); return failure;
  };
  const recovery = Object.freeze({ resourceId, transaction, releaseAfterClosure: async () => {
    if (!reconciling) reconciling = (async () => {
      if (operationError?.downloadSession) await settleInstallDownload(operationError);
      if (observerOverflow || observers.some(observe => !observe()) || resourcePending && !observers.length) {
        throw new Error('Actual Go SDK verifier child/tree closure remains pending.');
      }
      resourcePending = false;
      return cleanupTransaction();
    })().finally(() => { reconciling = null; });
    try { return await reconciling; }
    catch (error) { observeFailure(error); throw retainFailure(operationError || error, error); }
  } });
  try {
    const fetched = await download({ url: archive.sourceUrl, label: 'official Go SDK archive',
      timeoutMs, maxBytes: MAX_DOWNLOAD_BYTES, redirect: 'error', signal });
    if (fetched.sourceUrl !== archive.sourceUrl || fetched.body.length !== archive.size
      || computeSha256(fetched.body) !== archive.sha256) {
      throw createInstallError('go_sdk_checksum_mismatch', 'Go SDK bytes disagree with official size/source/SHA256 metadata.');
    }
    const archivePath = path.join(transaction, archive.filename);
    signal?.throwIfAborted();
    await fs.writeFile(archivePath, fetched.body, { flag: 'wx' });
    const extracted = path.join(transaction, 'extracted');
    await (dependencies.extract || extractArchive)(archivePath, extracted, archive.archiveType, GO_SDK_ARCHIVE_LIMITS);
    signal?.throwIfAborted();
    const goRoot = path.join(extracted, 'go');
    if (!(await fs.lstat(goRoot)).isDirectory() || await fs.realpath(goRoot) !== path.join(await fs.realpath(extracted), 'go')) {
      throw createInstallError('go_sdk_layout_invalid', 'Go SDK root must be an owned extracted directory.');
    }
    const command = await checkSdkLayout(goRoot, archive);
    const sdk = { goRoot, binDir: path.join(goRoot, 'bin') };
    const env = applyManagedGoEnvironment(baseEnv, { toolingRoot, sdk });
    env.GOENV = 'off';
    env.GOWORK = 'off';
    const probe = await verifyOwnedResource(input => (dependencies.probe || probeInstalledSdk)(command, input),
      { cwd: cwd || transaction, env, signal }, resourceId);
    observeFailure(probe);
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
    signal?.throwIfAborted();
    await fs.rename(extracted, destination);
    pointerTemp = path.join(cache, `.current-${randomUUID()}.json`);
    await fs.writeFile(pointerTemp, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
    pointerTempIdentity = await fs.lstat(pointerTemp, { bigint: true });
    const nowPointer = await fs.lstat(pointer).catch((error) => { if (error.code !== 'ENOENT') throw error; return null; });
    if ((pointerStat == null) !== (nowPointer == null) || (pointerStat &&
      (!nowPointer.isFile() || nowPointer.isSymbolicLink() || nowPointer.dev !== pointerStat.dev || nowPointer.ino !== pointerStat.ino
        || hashManagedGoFile(pointer, 64 * 1024) !== pointerHash))) {
      const changed = createInstallError('go_sdk_cache_changed', 'Go SDK active receipt changed during installation; the new SDK is retained without activation.');
      changed.recovery = { currentPointer: pointer, retainedGeneration: destination,
        currentSelectionPreserved: true, deletionAuthority: false };
      throw changed;
    }
    await fs.rename(pointerTemp, pointer);
    pointerTemp = null; pointerTempIdentity = null;
    const installed = resolveManagedGoSdk(toolingRoot, { platform, arch });
    if (!installed) throw createInstallError('go_sdk_cache_verification_failed', 'Published SDK receipt could not be verified.');
    return { ...installed, reused: false };
  } catch (value) {
    const error = asError(value);
    operationError = error;
    observeFailure(error);
    if (!resourcesSettled()) {
      pendingError = error;
      throw retainFailure(error);
    }
    throw error;
  } finally {
    if (!pendingError) {
      try { await cleanupTransaction(); }
      catch (error) { observeFailure(error); throw retainFailure(operationError || error, operationError ? error : null); }
    }
  }
};

export const ensureManagedGoSdk = async (options = {}) => {
  options.signal?.throwIfAborted();
  if (!resolveGoSdkTarget({ platform: options.platform || process.platform, arch: options.arch || process.arch })) throw createInstallError('go_sdk_unsupported_target', 'No portable Go SDK recipe for this platform/architecture.');
  if (!options.toolingRoot || !path.isAbsolute(options.toolingRoot)) throw createInstallError('go_sdk_cache_path_invalid', 'Managed Go SDK installation requires an absolute tooling directory.');
  const cached = resolveManagedGoSdk(options.toolingRoot, { platform: options.platform || process.platform, arch: options.arch || process.arch });
  if (cached && (!options.version || cached.version === options.version)) return { ...cached, reused: true };
  const publication = await runInstallWithStorageAdmission({ toolingRoot: options.toolingRoot,
    storageEstimate: options.storageEstimate, scope: 'managed-go-sdk-publication' }, () => ensureManagedGoSdkOwned(options));
  return publication.value;
};
