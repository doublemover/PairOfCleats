import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { atomicWriteJson } from '../../src/shared/io/atomic-write.js';
import { acquireFileLock, releaseFileLockOrThrow } from '../../src/shared/locks/file-lock.js';
import { assertNoSymlinkPath, readVerifiedContainedFile } from '../../src/shared/contained-file.js';
import { isPathWithinRoot } from '../../src/shared/file-paths.js';
import { inspectStorageAccess, withExclusiveStorageAccess } from '../../src/shared/storage/access.js';
import { acquireStorageSession, isStorageSessionReleaseFailure } from '../../src/shared/storage/session.js';
import { addStorageFailureContext } from '../../src/shared/storage/operation-error.js';
import { stableStringify } from '../../src/shared/stable-json.js';
import { resolveStorageLayout } from '../../src/shared/storage/layout.js';
import { extractArchive } from '../shared/archive-extraction.js';
import { computeSha256, downloadToBuffer, settleInstallDownload } from './install-shared.js';
import { runInstallWithStorageAdmission } from './install-storage.js';
import { retainManagedToolInstallation } from '../../src/shared/managed-installation.js';
import { isKnownManagedInstallationDescriptor, isKnownManagedInstallationReceipt } from '../../src/shared/managed-installation-contract.js';
import { storageFileIdentity } from '../../src/shared/storage/inventory.js';
import { verifyStorageFile, isStorageTransferSession } from '../../src/shared/storage/transfer.js';
import { getStorageDirectorySession, withStorageDirectory } from '../../src/shared/storage/directory.js';
import { verifyOwnedInstallation, verifyRetainedManagedInstallation, captureManagedVerificationFailure,
  retainManagedResourceFailure } from './managed-verification.js';
export { retainManagedToolInstallation, retainManagedToolInstallationSync } from '../../src/shared/managed-installation.js';

export const MANAGED_INSTALL_VERSION = 1;
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const DEFAULT_LIMITS = Object.freeze({ maxBytes: 1024 * 1024 * 1024, maxEntryBytes: 128 * 1024 * 1024, maxEntries: 50000 });
const hash = value => createHash('sha256').update(value).digest('hex');
const identity = value => hash(stableStringify(value));
const asManagedError = value => value && typeof value === 'object' ? value : new Error(String(value), { cause: value });
const failureDiagnostic = error => {
  const diagnostic = { code: null, message: 'Managed installation failed.' }, failures = [];
  for (const field of ['code', 'message']) {
    try { const value = error[field]; if (typeof value === 'string') diagnostic[field] = value; }
    catch (failure) { failures.push(asManagedError(failure)); }
  }
  return { diagnostic, failures };
};
const accessOptions = toolingRoot => ({ coordinationRoot: path.join(resolveStorageLayout({ overrides: { tooling: toolingRoot } }).descriptors.state.path, 'storage-access') });
const acquireManagedStorage = (toolingRoot, roots, scope, resourceId) => {
  const layout = resolveStorageLayout({ overrides: { tooling: toolingRoot } });
  return acquireStorageSession({ roots, scope, resourceId,
    authorizedRoots: [layout.descriptors.tooling.path, layout.descriptors.state.path],
    coordinationRoot: path.join(layout.descriptors.state.path, 'storage-access') });
};
const exactResourceReceipt = (receipt, resourceId) => receipt && typeof receipt === 'object' && !Array.isArray(receipt)
  && Object.keys(receipt).sort().join(',') === 'pending,resourceId,settled' && receipt.resourceId === resourceId
  && receipt.settled === true && receipt.pending === false;
const safeId = value => typeof value === 'string' && /^[a-z0-9][a-z0-9.-]{0,100}$/.test(value);
const relativePath = value => typeof value === 'string' && value.length <= 4096 && value.split('/').every(part => part && part !== '.' && part !== '..'
  && !/[\\:\x00-\x1f]/.test(part)) && !path.posix.isAbsolute(value);
const boundedJson = async file => {
  const read = await readVerifiedContainedFile(path.parse(file).root, file, { maxBytes: MAX_MANIFEST_BYTES });
  return JSON.parse(read.buffer.toString('utf8'));
};

/** Canonical profiles supply exact source authority; no latest/version discovery here. */
export const validatePinnedInstallDescriptor = (descriptor, { approvedOrigins = [], platform = process.platform, arch = process.arch } = {}) => {
  if (!isKnownManagedInstallationDescriptor(descriptor) || !safeId(descriptor.toolId)
    || !safeId(descriptor.recipeId) || !/^[a-zA-Z0-9][a-zA-Z0-9.+_-]{0,100}$/.test(descriptor.version || '')
    || /(?:latest|nightly|next)/i.test(descriptor.version)) throw new Error('Managed install needs a versioned canonical tool/profile/recipe descriptor.');
  if (descriptor.platform !== platform || descriptor.arch !== arch) throw new Error('Pinned managed recipe does not match this platform/architecture.');
  if (!['zip', 'tar.gz'].includes(descriptor.archive?.type)
    || !/^[a-f0-9]{64}$/.test(descriptor.archive?.sha256 || '')
    || !Number.isSafeInteger(descriptor.archive?.bytes) || descriptor.archive.bytes <= 0 || descriptor.archive.bytes > DEFAULT_LIMITS.maxBytes) throw new Error('Managed recipe requires bounded archive bytes and an immutable SHA256.');
  const url = new URL(descriptor.archive.url);
  if (url.protocol !== 'https:' || url.username || url.password || !approvedOrigins.includes(url.origin)
    || /(?:\/latest(?:\/|$)|@latest(?:\/|$)|[?&](?:version|tag)=latest)/i.test(url.href)) throw new Error('Archive source is outside its canonical approved immutable source authority.');
  if (!relativePath(descriptor.command) || (descriptor.root && !relativePath(descriptor.root))
    || !Array.isArray(descriptor.requiredFiles) || !descriptor.requiredFiles.length
    || descriptor.requiredFiles.some(file => !relativePath(file)) || !descriptor.requiredFiles.includes(descriptor.command)) throw new Error('Managed recipe requires a contained command and complete declared layout checks.');
  if (!Array.isArray(descriptor.args || []) || (descriptor.args || []).some(argument => typeof argument !== 'string')) throw new Error('Managed consumer arguments must be a string argv.');
  return { ...descriptor, descriptorId: identity(descriptor), approvedOrigins: [...approvedOrigins] };
};

const resolveOwner = async (toolingRoot, toolId, { create = false } = {}) => {
  if (!path.isAbsolute(toolingRoot) || !safeId(toolId)) throw new Error('Managed installation requires an absolute tooling owner and canonical tool id.');
  assertNoSymlinkPath(path.parse(toolingRoot).root, toolingRoot, { allowMissing: create });
  if (create) await fs.mkdir(toolingRoot, { recursive: true });
  const physical = await fs.realpath(toolingRoot);
  const owner = path.join(physical, 'installs', toolId);
  assertNoSymlinkPath(physical, owner, { allowMissing: create });
  if (create) await fs.mkdir(owner, { recursive: true });
  assertNoSymlinkPath(physical, owner);
  if (!isPathWithinRoot(await fs.realpath(owner), physical)) throw new Error('Managed installation owner escaped its tooling category.');
  return owner;
};

const captureFiles = async (root, limits = DEFAULT_LIMITS, { signal = null } = {}) => {
  const rows = [];
  const pending = [''];
  let bytes = 0;
  let entries = 0;
  while (pending.length) {
    signal?.throwIfAborted();
    const relative = pending.pop();
    const directory = path.join(root, relative);
    assertNoSymlinkPath(root, directory);
    await withStorageDirectory(directory, async handle => {
      for (let entry = await handle.read(); entry; entry = await handle.read()) {
        signal?.throwIfAborted();
        if (++entries > limits.maxEntries) throw new Error('Managed package inventory exceeds its entry limit.');
        const child = relative ? `${relative}/${entry.name}` : entry.name;
        if (!relativePath(child)) throw new Error('Unsafe managed installation file path.');
        if (entry.isDirectory()) pending.push(child);
        else {
          const file = path.join(root, child);
          const stat = await fs.lstat(file, { bigint: true });
          if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || stat.size > BigInt(limits.maxEntryBytes)) throw new Error('Managed package contains an unsupported linked/oversized file.');
          bytes += Number(stat.size);
          if (bytes > limits.maxBytes || rows.length >= limits.maxEntries) throw new Error('Managed package inventory exceeds its byte/entry limit.');
          const verified = await verifyStorageFile({ root, file, identity: storageFileIdentity(stat), maxBytes: limits.maxEntryBytes, signal });
          rows.push({ path: child, bytes: verified.bytes, sha256: verified.sha256 });
        }
      }
    });
  }
  return rows.sort((left, right) => left.path.localeCompare(right.path));
};

const inspectGeneration = async (owner, toolId, installId, { signal = null } = {}) => {
  signal?.throwIfAborted();
  if (!/^[a-f0-9]{64}$/.test(installId || '')) throw new Error('Managed generation requires its exact physical installation identity.');
  const receiptPath = path.join(owner, 'receipts', installId + '.json');
  assertNoSymlinkPath(owner, receiptPath);
  const receipt = await boundedJson(receiptPath);
  const root = path.join(owner, 'generations', installId);
  const expectedSelector = { schemaVersion: MANAGED_INSTALL_VERSION, toolId, descriptorId: receipt.descriptorId, installId };
  if (!isKnownManagedInstallationReceipt(receipt) || receipt.toolId !== toolId
    || receipt.installId !== installId || identity(receipt.descriptor) !== receipt.descriptorId
    || receipt.root !== root || receipt.selectorIdentity !== identity(expectedSelector)
    || receipt.descriptor?.schemaVersion !== MANAGED_INSTALL_VERSION || receipt.descriptor.toolId !== toolId
    || !relativePath(receipt.descriptor.command) || !Array.isArray(receipt.descriptor.args || [])
    || (receipt.descriptor.args || []).some(argument => typeof argument !== 'string')) throw new Error('Managed generation/receipt ownership disagrees.');
  let files;
  try { assertNoSymlinkPath(owner, root); files = await captureFiles(root, DEFAULT_LIMITS, { signal }); }
  catch (error) {
    if (signal?.aborted || isStorageTransferSession(error.storageTransferSession) || getStorageDirectorySession(error)) throw error;
    return { ok: false, state: 'repair-required', reason: error.code || error.message, receipt };
  }
  if (identity(files) !== receipt.filesIdentity) return { ok: false, state: 'repair-required', reason: 'managed-file-bytes-drift', receipt };
  return { ok: true, state: 'bytes-intact', owner, root, command: path.join(root, receipt.descriptor.command),
    args: receipt.descriptor.args || [], receipt, protocol: 'not-reprobed' };
};

const findRetainedGeneration = async (owner, toolId, descriptorId, { signal = null } = {}) => {
  signal?.throwIfAborted();
  const directory = path.join(owner, 'receipts');
  let names;
  try { names = await fs.readdir(directory); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (names.length > 1024) throw new Error('Managed receipt inventory exceeds its bound.');
  const candidates = [];
  for (const name of names.filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
    signal?.throwIfAborted();
    const receipt = await boundedJson(path.join(directory, name));
    if (receipt.descriptorId === descriptorId && receipt.toolId === toolId) candidates.push(receipt);
  }
  candidates.sort((left, right) => String(right.installedAt).localeCompare(String(left.installedAt)));
  for (const candidate of candidates) {
    const result = await inspectGeneration(owner, toolId, candidate.installId, { signal });
    if (result.ok) return result;
  }
  return null;
};

export const inspectManagedInstallation = async ({ toolingRoot, toolId, descriptorId = null, signal = null } = {}) => {
  try {
    signal?.throwIfAborted();
    const owner = await resolveOwner(toolingRoot, toolId);
    const selector = await boundedJson(path.join(owner, 'current.json'));
    if (selector.schemaVersion !== MANAGED_INSTALL_VERSION || !/^[a-f0-9]{64}$/.test(selector.descriptorId || '')
      || !/^[a-f0-9]{64}$/.test(selector.installId || '')
      || (descriptorId && descriptorId !== selector.descriptorId)) return { ok: false, state: 'different-selected-version', selector };
    if (identity(selector) !== identity({ schemaVersion: MANAGED_INSTALL_VERSION, toolId, descriptorId: selector.descriptorId, installId: selector.installId })) throw new Error('Managed selector has unknown ownership fields.');
    return await inspectGeneration(owner, toolId, selector.installId, { signal });
  } catch (error) {
    if (signal?.aborted || isStorageTransferSession(error.storageTransferSession) || getStorageDirectorySession(error)) throw error;
    return { ok: false, state: error.code === 'ENOENT' ? 'missing' : 'repair-required', reason: error.code || error.message };
  }
};

/** Explicit selected provisioning only. Prior generations and unowned assets are never adopted. */
const installPinnedManagedToolOwned = async ({ toolingRoot, descriptor, approvedOrigins,
  verify, repair = false, signal = null, download = downloadToBuffer, extract = extractArchive, onProgress = () => {} } = {}) => {
  const pinned = validatePinnedInstallDescriptor(descriptor, { approvedOrigins });
  if (typeof verify !== 'function') throw new Error('The canonical recipe must provide executable/runtime/capability verification.');
  signal?.throwIfAborted();
  const reused = await inspectManagedInstallation({ toolingRoot, toolId: pinned.toolId, descriptorId: pinned.descriptorId, signal });
  if (!repair && !reused.ok && reused.receipt?.descriptorId === pinned.descriptorId) throw new Error('Selected immutable installation drifted; use explicit owned repair to publish a sibling while preserving its evidence.');
  if (reused.ok) {
    const held = await retainManagedToolInstallation({ toolingRoot, toolId: pinned.toolId, descriptorId: pinned.descriptorId });
    const resourceId = randomUUID();
    const verification = await verifyRetainedManagedInstallation(held, verify,
      { root: held.root, command: held.command, args: held.args, descriptor: pinned, signal }, resourceId);
    return { ...reused, reused: true, downloadedBytes: 0, verification };
  }
  const owner = await resolveOwner(toolingRoot, pinned.toolId, { create: true });
  const transactionId = randomUUID();
  const categorySession = acquireManagedStorage(toolingRoot, [toolingRoot], 'managed-tool-install-resource', transactionId);
  let lock = null;
  const installId = identity({ descriptorId: pinned.descriptorId, transactionId });
  const stage = path.join(owner, '.stage-' + transactionId);
  const journal = path.join(owner, 'transactions', transactionId + '.json');
  let stageIdentity = null;
  let state = 'preparing';
  let promoted = null;
  let pending = false;
  let released = false;
  let primaryError = null;
  let verificationLease = null;
  let resourcePending = false, reconciling = null, observerOverflow = false;
  const observers = [], observed = new WeakSet(), described = new WeakSet(), ownedMetadataFailures = new WeakSet();
  const directorySessions = new Set(), transferSessions = new Set();
  const observeFailure = error => {
    if (!error || typeof error !== 'object' || observed.has(error) || described.has(error) || ownedMetadataFailures.has(error)) return;
    observed.add(error);
    const directory = getStorageDirectorySession(error);
    if (directory) directorySessions.add(directory);
    if (isStorageTransferSession(error.storageTransferSession)) transferSessions.add(error.storageTransferSession);
    const captured = captureManagedVerificationFailure(error, transactionId);
    if (captured.observe) {
      if (observers.length < 128) observers.push(captured.observe);
      else observerOverflow = true;
    }
    if (captured.owned || captured.observe && !captured.observe()) resourcePending = true;
  };
  const resourcesSettled = () => !observerOverflow && !resourcePending && observers.every(observe => observe());
  const releaseSession = session => {
    try { return session.releaseAfterSettlement({ resourceId: session.resourceId, settled: true, pending: false }); }
    catch (error) { if (isStorageSessionReleaseFailure(error, session)) ownedMetadataFailures.add(error); throw error; }
  };
  const admitVerification = (scope = 'managed-retained-generation-verifier') => {
    try { verificationLease = acquireManagedStorage(toolingRoot, [owner], scope, transactionId); }
    catch (error) {
      const partial = error.storageSession;
      if (partial && (isStorageSessionReleaseFailure(error, partial) || isStorageSessionReleaseFailure(error.storageSettlementError, partial))) {
        verificationLease = partial;
        ownedMetadataFailures.add(error);
      }
      throw error;
    }
  };
  const releaseResources = async () => {
    if (!resourcesSettled()) throw new Error('Managed install child/resource settlement is still pending.');
    if (released) return true;
    if (verificationLease) {
      if (releaseSession(verificationLease) !== true) throw new Error('Managed retained-generation verification lease changed before release.');
      verificationLease = null;
    }
    if (stageIdentity) {
      let actual;
      try { actual = await fs.lstat(stage, { bigint: true }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (actual) {
        if (actual.isSymbolicLink() || actual.dev !== stageIdentity.dev || actual.ino !== stageIdentity.ino || !isPathWithinRoot(stage, owner)) {
          throw new Error('Managed installer staging identity changed; unknown evidence is preserved.');
        }
        await fs.rm(stage, { recursive: true, force: false });
      }
    }
    if (lock) { await releaseFileLockOrThrow(lock); lock = null; }
    if (releaseSession(categorySession) !== true) throw new Error('Managed installer category lease changed before release.');
    released = true;
    return true;
  };
  const recovery = Object.freeze({ resourceId: transactionId, stage, journal, releaseAfterSettlement: async receipt => {
    if (!exactResourceReceipt(receipt, transactionId)) throw new Error('Managed install child settlement is still pending.');
    if (!reconciling) reconciling = (async () => {
      if (primaryError?.downloadSession) await settleInstallDownload(primaryError);
      for (const session of [...transferSessions, ...directorySessions]) {
        const closed = await session.releaseAfterClose();
        if (!exactResourceReceipt(closed, session.resourceId) || !session.isSettled()) {
          throw new Error('Actual managed install descriptor owner did not confirm exact closure.');
        }
      }
      if (observerOverflow || observers.some(observe => !observe())) throw new Error('Actual managed install native/resource observer remains pending.');
      resourcePending = false;
      return releaseResources();
    })().finally(() => { reconciling = null; });
    try { return await reconciling; }
    catch (cleanupError) {
      observeFailure(cleanupError);
      const failure = retainManagedResourceFailure(primaryError || cleanupError, { session: recovery,
        released: () => released && resourcesSettled(), cleanupError });
      described.add(failure); throw failure;
    }
  } });
  const checkpoint = async extra => {
    await atomicWriteJson(journal, { schemaVersion: MANAGED_INSTALL_VERSION, application: 'pairofcleats',
      toolId: pinned.toolId, descriptorId: pinned.descriptorId, transactionId, state, previousPreserved: true,
      ...extra }, { mkdir: true });
    await onProgress({ toolId: pinned.toolId, transactionId, state, ...extra });
  };
  try {
    lock = await acquireFileLock({ lockPath: path.join(owner, 'install.lock'), waitMs: 0, signal,
      metadata: { scope: 'managed-tool-install', toolId: pinned.toolId, descriptorId: pinned.descriptorId } });
    if (!lock) throw new Error('Another managed installer owns this tool; retry after it settles.');
    const resumable = await findRetainedGeneration(owner, pinned.toolId, pinned.descriptorId, { signal });
    if (resumable?.ok) {
      admitVerification();
      const retained = await inspectGeneration(owner, pinned.toolId, resumable.receipt.installId, { signal });
      if (!retained.ok) throw new Error('Retained managed generation changed before verification admission.');
      const verification = await verifyOwnedInstallation(verify, { root: retained.root, command: retained.command, args: retained.args, descriptor: pinned, signal }, transactionId);
      if (releaseSession(verificationLease) !== true) throw new Error('Retained-generation verification lease changed before publication.');
      verificationLease = null;
      const publication = await withExclusiveStorageAccess(owner, async () => {
        signal?.throwIfAborted();
        if (!(await inspectGeneration(owner, pinned.toolId, retained.receipt.installId, { signal })).ok) throw new Error('Retained managed generation changed before publication.');
        await atomicWriteJson(path.join(owner, 'current.json'), { schemaVersion: MANAGED_INSTALL_VERSION,
          toolId: pinned.toolId, descriptorId: pinned.descriptorId, installId: retained.receipt.installId }, { mkdir: false });
      }, accessOptions(toolingRoot));
      return { ...retained, ok: !publication.protected, state: publication.protected ? 'verified-awaiting-owner-release' : 'complete',
        reused: true, downloadedBytes: 0, previousPreserved: true, verification };
    }
    await fs.mkdir(stage);
    stageIdentity = await fs.lstat(stage, { bigint: true });
    await checkpoint({ requestedVersion: pinned.version, source: pinned.archive.url });
    state = 'downloading';
    await checkpoint({ expectedBytes: pinned.archive.bytes });
    const fetched = await download({ url: pinned.archive.url, label: pinned.toolId + ' pinned archive',
      timeoutMs: 120000, maxBytes: pinned.archive.bytes, redirect: 'error', signal });
    signal?.throwIfAborted();
    if (fetched.sourceUrl !== pinned.archive.url || fetched.body.length !== pinned.archive.bytes
      || computeSha256(fetched.body) !== pinned.archive.sha256) throw new Error('Pinned tool archive source/size/SHA256 mismatch.');
    const archive = path.join(stage, 'archive.' + pinned.archive.type);
    await fs.writeFile(archive, fetched.body, { flag: 'wx' });
    const extracted = path.join(stage, 'extracted');
    state = 'extracting';
    await checkpoint({ downloadedBytes: fetched.body.length });
    await extract(archive, extracted, pinned.archive.type, DEFAULT_LIMITS);
    signal?.throwIfAborted();
    const packageRoot = pinned.root ? path.join(extracted, pinned.root) : extracted;
    assertNoSymlinkPath(stage, packageRoot);
    for (const relative of pinned.requiredFiles) {
      const file = path.join(packageRoot, relative);
      assertNoSymlinkPath(packageRoot, file);
      const stat = await fs.lstat(file);
      if (!stat.isFile() || !stat.size) throw new Error('Pinned tool layout is missing required file: ' + relative);
    }
    if (process.platform !== 'win32') for (const relative of pinned.executables || [pinned.command]) {
      if (!relativePath(relative)) throw new Error('Unsafe executable mode path.');
      await fs.chmod(path.join(packageRoot, relative), 0o755);
    }
    const files = await captureFiles(packageRoot, DEFAULT_LIMITS, { signal });
    state = 'verifying';
    await checkpoint({ files: files.length });
    admitVerification('managed-new-generation-verifier');
    const verification = await verifyOwnedInstallation(verify, { root: packageRoot, command: path.join(packageRoot, pinned.command),
      args: pinned.args || [], descriptor: pinned, signal }, transactionId);
    if (identity(await captureFiles(packageRoot, DEFAULT_LIMITS, { signal })) !== identity(files)) throw new Error('Tool verification mutated immutable installation bytes.');
    if (releaseSession(verificationLease) !== true) throw new Error('New-generation verification lease changed before publication.');
    verificationLease = null;
    signal?.throwIfAborted();
    await fs.mkdir(path.join(owner, 'generations'), { recursive: true });
    const destination = path.join(owner, 'generations', installId);
    assertNoSymlinkPath(owner, destination, { allowMissing: true });
    try { await fs.lstat(destination); throw new Error('An unselected existing generation occupies the requested immutable slot; preserve it for explicit repair.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.rename(packageRoot, destination);
    promoted = destination;
    const selector = { schemaVersion: MANAGED_INSTALL_VERSION, toolId: pinned.toolId, descriptorId: pinned.descriptorId, installId };
    const receipt = { schemaVersion: MANAGED_INSTALL_VERSION, application: 'pairofcleats', toolId: pinned.toolId,
      descriptorId: pinned.descriptorId, installId, descriptor, root: destination, source: pinned.archive,
      files, filesIdentity: identity(files), selectorIdentity: identity(selector), verification,
      installedAt: new Date().toISOString(), ownership: 'managed', leaseProtocol: 'storage-asset-access-v1' };
    await atomicWriteJson(path.join(owner, 'receipts', installId + '.json'), receipt, { mkdir: true, createOnly: true });
    state = 'publishing';
    await checkpoint({ root: destination });
    const publication = await withExclusiveStorageAccess(owner, async () => {
      signal?.throwIfAborted();
      await atomicWriteJson(path.join(owner, 'current.json'), selector, { mkdir: false });
      return { selected: true };
    }, accessOptions(toolingRoot));
    if (publication?.protected) {
      state = 'verified-awaiting-owner-release';
      await checkpoint({ reason: publication.reason, root: destination });
      return { ok: false, state, previousPreserved: true, root: destination, descriptorId: pinned.descriptorId, installId, receipt };
    }
    state = 'complete';
    await checkpoint({ root: destination });
    return { ok: true, state, root: destination, command: path.join(destination, pinned.command),
      args: pinned.args || [], descriptorId: pinned.descriptorId, installId, receipt, reused: false,
      downloadedBytes: fetched.body.length, verification, previousPreserved: true };
  } catch (value) {
    const error = asManagedError(value);
    primaryError = error;
    observeFailure(error);
    pending = !resourcesSettled();
    state = signal?.aborted ? 'cancelled' : 'failed';
    if (lock) {
      const { diagnostic, failures } = failureDiagnostic(error);
      for (const failure of failures) primaryError = addStorageFailureContext(primaryError, { managedDiagnosticError: failure }, failure);
      try { await checkpoint({ ...diagnostic, promotedRoot: promoted }); }
      catch (journalError) {
        const journalFailure = asManagedError(journalError);
        observeFailure(journalFailure);
        primaryError = addStorageFailureContext(primaryError, { managedJournalError: journalFailure }, journalFailure);
      }
    }
    pending = !resourcesSettled();
    if (pending) {
      const failure = retainManagedResourceFailure(primaryError, { session: recovery, released: () => released && resourcesSettled() });
      described.add(failure); throw failure;
    }
    throw primaryError;
  } finally {
    if (!pending) {
      try { await releaseResources(); }
      catch (error) {
        observeFailure(error);
        const failure = retainManagedResourceFailure(primaryError || error, { session: recovery,
          released: () => released && resourcesSettled(), cleanupError: primaryError ? error : null });
        described.add(failure); throw failure;
      }
    }
  }
};

export const installPinnedManagedTool = async options => {
  options.signal?.throwIfAborted();
  const pinned = validatePinnedInstallDescriptor(options.descriptor, { approvedOrigins: options.approvedOrigins });
  const selected = await inspectManagedInstallation({ toolingRoot: options.toolingRoot, toolId: pinned.toolId, descriptorId: pinned.descriptorId, signal: options.signal });
  if (selected.ok) return installPinnedManagedToolOwned(options);
  const publication = await runInstallWithStorageAdmission({ toolingRoot: options.toolingRoot,
    storageEstimate: options.descriptor.storageEstimate, scope: 'managed-tool-archive-publication' }, () => installPinnedManagedToolOwned(options));
  return publication.value;
};

export const inspectManagedToolRemoval = async options => {
  const selected = await inspectManagedInstallation(options);
  const access = selected.ok ? await inspectStorageAccess(selected.owner, accessOptions(options.toolingRoot)) : null;
  options.signal?.throwIfAborted();
  const body = { schemaVersion: 1, kind: 'managed-tool-removal-plan', toolId: options.toolId, toolingRoot: path.resolve(options.toolingRoot),
    descriptorId: selected.receipt?.descriptorId || null, root: selected.root || null,
    installId: selected.receipt?.installId || null,
    state: selected.ok && access?.complete && !access.protected ? 'owned-and-idle' : 'blocked',
    access, verification: selected.state, removal: 'explicit-selected-version-only',
    limitation: 'No external/prior unreceipted installation is adopted.' };
  return { ...body, planId: identity(body) };
};

const removeOwnedManagedTool = async (approved, { signal = null } = {}) => {
  signal?.throwIfAborted();
  const current = await inspectManagedToolRemoval({ toolingRoot: approved.toolingRoot, toolId: approved.toolId, signal });
  if (current.planId !== approved.planId || current.state !== 'owned-and-idle') throw new Error('Managed tool removal plan changed or has an active/unknown owner.');
  const selected = await inspectManagedInstallation({ toolingRoot: approved.toolingRoot, toolId: approved.toolId, signal });
  const result = await withExclusiveStorageAccess(selected.owner, async () => {
    const verified = await inspectManagedInstallation({ toolingRoot: approved.toolingRoot, toolId: approved.toolId, descriptorId: approved.descriptorId, signal });
    if (!verified.ok || verified.root !== approved.root) throw new Error('Managed removal identity changed under exclusion.');
    assertNoSymlinkPath(selected.owner, verified.root);
    if (!isPathWithinRoot(verified.root, path.join(selected.owner, 'generations'))) throw new Error('Managed removal target is outside its versioned owner.');
    const operationId = randomUUID();
    const retired = path.join(selected.owner, '.retired-' + operationId);
    const retainedSelector = path.join(selected.owner, 'removed-selector-' + operationId + '.json');
    const journal = path.join(selected.owner, 'transactions', operationId + '.json');
    signal?.throwIfAborted();
    await atomicWriteJson(journal, { schemaVersion: 1, operation: 'remove', planId: approved.planId,
      descriptorId: approved.descriptorId, original: verified.root, retired, state: 'approved-owned-removal' }, { mkdir: true });
    signal?.throwIfAborted();
    // After retirement starts, finish this admitted critical section. Aborting
    // between selector and generation renames would manufacture a broken tool.
    await fs.rename(path.join(selected.owner, 'current.json'), retainedSelector);
    try { await fs.rename(verified.root, retired); }
    catch (error) {
      try { await fs.rename(retainedSelector, path.join(selected.owner, 'current.json')); }
      catch (rollbackError) { throw addStorageFailureContext(error, { managedRemovalRollback: { journal, retainedSelector, retired } }, rollbackError); }
      throw error;
    }
    // Exclusion, verified full inventory and the exact retained generation grant
    // deletion authority for this one directory only. Other versions/evidence stay.
    assertNoSymlinkPath(selected.owner, retired);
    await fs.rm(retired, { recursive: true, force: false });
    await atomicWriteJson(journal, { schemaVersion: 1, operation: 'remove', planId: approved.planId,
      descriptorId: approved.descriptorId, state: 'removed', retainedSelector, receiptRetained: true }, { mkdir: false });
    return { ok: true, removed: approved.descriptorId, receiptRetained: true, otherVersionsPreserved: true };
  }, accessOptions(approved.toolingRoot));
  return result.protected ? { ok: false, ...result } : result.result;
};

export const removePinnedManagedTool = async (approved, { signal = null } = {}) => {
  signal?.throwIfAborted();
  if (!path.isAbsolute(approved?.toolingRoot || '')) throw new Error('Managed removal requires its absolute tooling owner.');
  const resourceId = randomUUID();
  const categorySession = acquireManagedStorage(approved.toolingRoot, [approved.toolingRoot], 'managed-tool-removal-resource', resourceId);
  let primaryError = null, released = false, observe = null;
  const release = () => {
    if (observe && !observe()) throw new Error('Actual managed removal resource remains pending.');
    if (released) return true;
    if (categorySession.releaseAfterSettlement({ resourceId, settled: true, pending: false }) !== true) {
      throw new Error('Managed removal category lease changed before release.');
    }
    released = true;
    return true;
  };
  const retainFailure = (primary, cleanupError = null) => retainManagedResourceFailure(primary, { session: recovery,
    field: 'managedRemovalSession', released: () => released && (!observe || observe()), cleanupError });
  const recovery = Object.freeze({ resourceId, releaseAfterSettlement: receipt => {
    if (!exactResourceReceipt(receipt, resourceId)) throw new Error('Managed removal requires its exact resource receipt and explicit pending:false.');
    try { return release(); }
    catch (cleanupError) { throw retainFailure(primaryError || cleanupError, cleanupError); }
  } });
  try { return await removeOwnedManagedTool(approved, { signal }); }
  catch (value) {
    const error = asManagedError(value);
    primaryError = error; observe = captureManagedVerificationFailure(error, resourceId).observe; throw error;
  }
  finally {
    try { release(); }
    catch (cleanupError) { throw retainFailure(primaryError || cleanupError, primaryError ? cleanupError : null); }
  }
};
