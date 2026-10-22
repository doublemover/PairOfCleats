import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { atomicWriteJson } from '../../src/shared/io/atomic-write.js';
import { acquireFileLock, releaseFileLockOrThrow } from '../../src/shared/locks/file-lock.js';
import { assertNoSymlinkPath } from '../../src/shared/contained-file.js';
import { isPathWithinRoot } from '../../src/shared/file-paths.js';
import { inspectStorageAccess, withExclusiveStorageAccess } from '../../src/shared/storage/access.js';
import { acquireRepoCacheAccessLease } from '../../src/shared/cache/repo-access.js';
import { stableStringify } from '../../src/shared/stable-json.js';
import { resolveStorageLayout } from '../../src/shared/storage/layout.js';
import { extractArchive } from '../shared/archive-extraction.js';
import { computeSha256, downloadToBuffer } from './install-shared.js';

export const MANAGED_INSTALL_VERSION = 1;
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const DEFAULT_LIMITS = Object.freeze({ maxBytes: 1024 * 1024 * 1024, maxEntryBytes: 128 * 1024 * 1024, maxEntries: 50000 });
const hash = value => createHash('sha256').update(value).digest('hex');
const identity = value => hash(stableStringify(value));
const accessOptions = toolingRoot => ({ coordinationRoot: path.join(resolveStorageLayout({ overrides: { tooling: toolingRoot } }).descriptors.state.path, 'storage-access') });
const safeId = value => typeof value === 'string' && /^[a-z0-9][a-z0-9.-]{0,100}$/.test(value);
const relativePath = value => typeof value === 'string' && value.length <= 4096 && value.split('/').every(part => part && part !== '.' && part !== '..'
  && !/[\\:\x00-\x1f]/.test(part)) && !path.posix.isAbsolute(value);
const verifyOwnedInstallation = async (verify, input, resourceId) => {
  let result;
  try { result = await verify({ ...input, resourceId }); }
  catch (cause) {
    const error = cause && typeof cause === 'object' ? cause : new Error(String(cause));
    if (error?.settlement?.resourceId !== resourceId || error.settlement.settled !== true || error.settlement.pending === true) {
      error.cacheOwnershipPending = true;
    }
    throw error;
  }
  if (result?.settlement?.resourceId !== resourceId || result.settlement.settled !== true || result.settlement.pending === true) {
    throw Object.assign(new Error('Managed recipe verification did not confirm exact child/resource settlement.'), { code: 'ERR_MANAGED_VERIFY_PENDING', cacheOwnershipPending: true });
  }
  if (result.ok !== true) throw new Error('Pinned tool executable/runtime/capability verification failed.');
  return result;
};
const boundedJson = async file => {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_MANIFEST_BYTES) throw new Error('Invalid managed-install metadata file.');
  return JSON.parse(await fs.readFile(file, 'utf8'));
};

/** Canonical profiles supply exact source authority; no latest/version discovery here. */
export const validatePinnedInstallDescriptor = (descriptor, { approvedOrigins = [], platform = process.platform, arch = process.arch } = {}) => {
  if (descriptor?.schemaVersion !== MANAGED_INSTALL_VERSION || !safeId(descriptor.toolId)
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

const captureFiles = async (root, limits = DEFAULT_LIMITS) => {
  const rows = [];
  const pending = [''];
  let bytes = 0;
  let entries = 0;
  while (pending.length) {
    const relative = pending.pop();
    const directory = path.join(root, relative);
    assertNoSymlinkPath(root, directory);
    const handle = await fs.opendir(directory);
    try {
      for (let entry = await handle.read(); entry; entry = await handle.read()) {
        if (++entries > limits.maxEntries) throw new Error('Managed package inventory exceeds its entry limit.');
        const child = relative ? `${relative}/${entry.name}` : entry.name;
        if (!relativePath(child)) throw new Error('Unsafe managed installation file path.');
        if (entry.isDirectory()) pending.push(child);
        else {
          const file = path.join(root, child);
          const stat = await fs.lstat(file);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > limits.maxEntryBytes) throw new Error('Managed package contains an unsupported linked/oversized file.');
          bytes += stat.size;
          if (bytes > limits.maxBytes || rows.length >= limits.maxEntries) throw new Error('Managed package inventory exceeds its byte/entry limit.');
          const contents = await fs.readFile(file);
          const after = await fs.stat(file);
          if (stat.size !== after.size || stat.mtimeMs !== after.mtimeMs || contents.length !== stat.size) throw new Error('Managed package changed while recording file identity.');
          rows.push({ path: child, bytes: contents.length, sha256: computeSha256(contents) });
        }
      }
    } finally { await handle.close(); }
  }
  return rows.sort((left, right) => left.path.localeCompare(right.path));
};

const inspectGeneration = async (owner, toolId, installId) => {
  if (!/^[a-f0-9]{64}$/.test(installId || '')) throw new Error('Managed generation requires its exact physical installation identity.');
  const receiptPath = path.join(owner, 'receipts', installId + '.json');
  assertNoSymlinkPath(owner, receiptPath);
  const receipt = await boundedJson(receiptPath);
  const root = path.join(owner, 'generations', installId);
  const expectedSelector = { schemaVersion: MANAGED_INSTALL_VERSION, toolId, descriptorId: receipt.descriptorId, installId };
  if (receipt.schemaVersion !== MANAGED_INSTALL_VERSION || receipt.application !== 'pairofcleats' || receipt.toolId !== toolId
    || receipt.installId !== installId || identity(receipt.descriptor) !== receipt.descriptorId
    || receipt.root !== root || receipt.selectorIdentity !== identity(expectedSelector)
    || receipt.descriptor?.schemaVersion !== MANAGED_INSTALL_VERSION || receipt.descriptor.toolId !== toolId
    || !relativePath(receipt.descriptor.command) || !Array.isArray(receipt.descriptor.args || [])
    || (receipt.descriptor.args || []).some(argument => typeof argument !== 'string')) throw new Error('Managed generation/receipt ownership disagrees.');
  let files;
  try { assertNoSymlinkPath(owner, root); files = await captureFiles(root); }
  catch (error) { return { ok: false, state: 'repair-required', reason: error.code || error.message, receipt }; }
  if (identity(files) !== receipt.filesIdentity) return { ok: false, state: 'repair-required', reason: 'managed-file-bytes-drift', receipt };
  return { ok: true, state: 'bytes-intact', owner, root, command: path.join(root, receipt.descriptor.command),
    args: receipt.descriptor.args || [], receipt, protocol: 'not-reprobed' };
};

const findRetainedGeneration = async (owner, toolId, descriptorId) => {
  const directory = path.join(owner, 'receipts');
  let names;
  try { names = await fs.readdir(directory); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (names.length > 1024) throw new Error('Managed receipt inventory exceeds its bound.');
  const candidates = [];
  for (const name of names.filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
    const receipt = await boundedJson(path.join(directory, name));
    if (receipt.descriptorId === descriptorId && receipt.toolId === toolId) candidates.push(receipt);
  }
  candidates.sort((left, right) => String(right.installedAt).localeCompare(String(left.installedAt)));
  for (const candidate of candidates) {
    const result = await inspectGeneration(owner, toolId, candidate.installId);
    if (result.ok) return result;
  }
  return null;
};

export const inspectManagedInstallation = async ({ toolingRoot, toolId, descriptorId = null } = {}) => {
  try {
    const owner = await resolveOwner(toolingRoot, toolId);
    const selector = await boundedJson(path.join(owner, 'current.json'));
    if (selector.schemaVersion !== MANAGED_INSTALL_VERSION || !/^[a-f0-9]{64}$/.test(selector.descriptorId || '')
      || !/^[a-f0-9]{64}$/.test(selector.installId || '')
      || (descriptorId && descriptorId !== selector.descriptorId)) return { ok: false, state: 'different-selected-version', selector };
    if (identity(selector) !== identity({ schemaVersion: MANAGED_INSTALL_VERSION, toolId, descriptorId: selector.descriptorId, installId: selector.installId })) throw new Error('Managed selector has unknown ownership fields.');
    return await inspectGeneration(owner, toolId, selector.installId);
  } catch (error) {
    return { ok: false, state: error.code === 'ENOENT' ? 'missing' : 'repair-required', reason: error.code || error.message };
  }
};

/** Explicit selected provisioning only. Prior generations and unowned assets are never adopted. */
export const installPinnedManagedTool = async ({ toolingRoot, descriptor, approvedOrigins,
  verify, repair = false, signal = null, download = downloadToBuffer, extract = extractArchive, onProgress = () => {} } = {}) => {
  const pinned = validatePinnedInstallDescriptor(descriptor, { approvedOrigins });
  if (typeof verify !== 'function') throw new Error('The canonical recipe must provide executable/runtime/capability verification.');
  signal?.throwIfAborted();
  const reused = await inspectManagedInstallation({ toolingRoot, toolId: pinned.toolId, descriptorId: pinned.descriptorId });
  if (!repair && !reused.ok && reused.receipt?.descriptorId === pinned.descriptorId) throw new Error('Selected immutable installation drifted; use explicit owned repair to publish a sibling while preserving its evidence.');
  if (reused.ok) {
    const held = await retainManagedToolInstallation({ toolingRoot, toolId: pinned.toolId, descriptorId: pinned.descriptorId });
    const resourceId = randomUUID();
    let pending = false;
    let primaryError = null;
    try {
      const verification = await verifyOwnedInstallation(verify, { root: held.root, command: held.command, args: held.args, descriptor: pinned, signal }, resourceId);
      return { ...reused, reused: true, downloadedBytes: 0, verification };
    } catch (error) {
      primaryError = error;
      if (error.cacheOwnershipPending) {
        pending = true;
        Object.defineProperty(error, 'managedInstallSession', { value: { resourceId,
          releaseAfterSettlement: receipt => {
            if (receipt?.resourceId !== resourceId || receipt.settled !== true || receipt.pending === true) throw new Error('Managed verification remains pending.');
            return held.release();
          } }, configurable: true });
      }
      throw error;
    } finally {
      if (!pending && !held.release()) {
        const cleanupError = new Error('Managed tool verification lease could not be released.');
        if (!primaryError) throw cleanupError;
        primaryError.managedCleanupError = cleanupError;
      }
    }
  }
  const owner = await resolveOwner(toolingRoot, pinned.toolId, { create: true });
  const categoryLease = acquireRepoCacheAccessLease(toolingRoot, accessOptions(toolingRoot));
  let lock;
  try {
    lock = await acquireFileLock({ lockPath: path.join(owner, 'install.lock'), waitMs: 0, signal,
      metadata: { scope: 'managed-tool-install', toolId: pinned.toolId, descriptorId: pinned.descriptorId } });
  } catch (error) { categoryLease.release(); throw error; }
  if (!lock) { categoryLease.release(); throw new Error('Another managed installer owns this tool; retry after it settles.'); }
  const transactionId = randomUUID();
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
  const releaseResources = async () => {
    if (released) return true;
    if (verificationLease) {
      if (!verificationLease.release()) throw new Error('Managed retained-generation verification lease changed before release.');
      verificationLease = null;
    }
    if (stageIdentity) {
      const actual = await fs.lstat(stage, { bigint: true }).catch(() => null);
      if (actual && !actual.isSymbolicLink() && actual.dev === stageIdentity.dev && actual.ino === stageIdentity.ino
        && isPathWithinRoot(stage, owner)) await fs.rm(stage, { recursive: true, force: true });
    }
    await releaseFileLockOrThrow(lock);
    if (!categoryLease.release()) throw new Error('Managed installer category lease changed before release.');
    released = true;
    return true;
  };
  const checkpoint = async extra => {
    await atomicWriteJson(journal, { schemaVersion: MANAGED_INSTALL_VERSION, application: 'pairofcleats',
      toolId: pinned.toolId, descriptorId: pinned.descriptorId, transactionId, state, previousPreserved: true,
      ...extra }, { mkdir: true });
    onProgress({ toolId: pinned.toolId, transactionId, state, ...extra });
  };
  try {
    const resumable = await findRetainedGeneration(owner, pinned.toolId, pinned.descriptorId);
    if (resumable?.ok) {
      verificationLease = acquireRepoCacheAccessLease(owner, accessOptions(toolingRoot));
      const retained = await inspectGeneration(owner, pinned.toolId, resumable.receipt.installId);
      if (!retained.ok) throw new Error('Retained managed generation changed before verification admission.');
      const verification = await verifyOwnedInstallation(verify, { root: retained.root, command: retained.command, args: retained.args, descriptor: pinned, signal }, transactionId);
      if (!verificationLease.release()) throw new Error('Retained-generation verification lease changed before publication.');
      verificationLease = null;
      const publication = await withExclusiveStorageAccess(owner, async () => {
        signal?.throwIfAborted();
        if (!(await inspectGeneration(owner, pinned.toolId, retained.receipt.installId)).ok) throw new Error('Retained managed generation changed before publication.');
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
    const files = await captureFiles(packageRoot);
    state = 'verifying';
    await checkpoint({ files: files.length });
    const verification = await verifyOwnedInstallation(verify, { root: packageRoot, command: path.join(packageRoot, pinned.command),
      args: pinned.args || [], descriptor: pinned, signal }, transactionId);
    if (identity(await captureFiles(packageRoot)) !== identity(files)) throw new Error('Tool verification mutated immutable installation bytes.');
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
  } catch (error) {
    primaryError = error;
    pending = error.cacheOwnershipPending === true;
    state = signal?.aborted ? 'cancelled' : 'failed';
    await checkpoint({ code: error.code || null, message: error.message, promotedRoot: promoted }).catch(() => {});
    if (pending) Object.defineProperty(error, 'managedInstallSession', { value: { resourceId: transactionId, stage, journal,
      releaseAfterSettlement: receipt => {
        if (receipt?.resourceId !== transactionId || receipt.settled !== true || receipt.pending === true) throw new Error('Managed install child settlement is still pending.');
        return releaseResources();
      } }, configurable: true });
    throw error;
  } finally {
    if (!pending) {
      try { await releaseResources(); }
      catch (error) {
        if (!primaryError) throw error;
        primaryError.managedCleanupError = error;
        throw primaryError;
      }
    }
  }
};

/** Consumers pin the exact selected generation until all owned children settle. */
export const retainManagedToolInstallation = async options => {
  const selected = await inspectManagedInstallation(options);
  if (!selected.ok) throw new Error('Managed tool selection is unavailable: ' + selected.state);
  const leases = [acquireRepoCacheAccessLease(options.toolingRoot, accessOptions(options.toolingRoot))];
  try { leases.push(acquireRepoCacheAccessLease(selected.owner, accessOptions(options.toolingRoot))); }
  catch (error) { leases[0].release(); throw error; }
  const release = () => leases.map(lease => lease.release()).every(Boolean);
  try {
    const after = await inspectManagedInstallation(options);
    if (!after.ok || after.receipt.installId !== selected.receipt.installId) throw new Error('Managed tool selection changed before consumer lease admission; retry.');
    return { ...after, release };
  } catch (error) { release(); throw error; }
};

export const inspectManagedToolRemoval = async options => {
  const selected = await inspectManagedInstallation(options);
  const access = selected.ok ? await inspectStorageAccess(selected.owner, accessOptions(options.toolingRoot)) : null;
  const body = { schemaVersion: 1, kind: 'managed-tool-removal-plan', toolId: options.toolId, toolingRoot: path.resolve(options.toolingRoot),
    descriptorId: selected.receipt?.descriptorId || null, root: selected.root || null,
    installId: selected.receipt?.installId || null,
    state: selected.ok && access?.complete && !access.protected ? 'owned-and-idle' : 'blocked',
    access, verification: selected.state, removal: 'explicit-selected-version-only',
    limitation: 'No external/prior unreceipted installation is adopted.' };
  return { ...body, planId: identity(body) };
};

const removeOwnedManagedTool = async approved => {
  const current = await inspectManagedToolRemoval({ toolingRoot: approved.toolingRoot, toolId: approved.toolId });
  if (current.planId !== approved.planId || current.state !== 'owned-and-idle') throw new Error('Managed tool removal plan changed or has an active/unknown owner.');
  const selected = await inspectManagedInstallation({ toolingRoot: approved.toolingRoot, toolId: approved.toolId });
  const result = await withExclusiveStorageAccess(selected.owner, async () => {
    const verified = await inspectManagedInstallation({ toolingRoot: approved.toolingRoot, toolId: approved.toolId, descriptorId: approved.descriptorId });
    if (!verified.ok || verified.root !== approved.root) throw new Error('Managed removal identity changed under exclusion.');
    assertNoSymlinkPath(selected.owner, verified.root);
    if (!isPathWithinRoot(verified.root, path.join(selected.owner, 'generations'))) throw new Error('Managed removal target is outside its versioned owner.');
    const operationId = randomUUID();
    const retired = path.join(selected.owner, '.retired-' + operationId);
    const retainedSelector = path.join(selected.owner, 'removed-selector-' + operationId + '.json');
    const journal = path.join(selected.owner, 'transactions', operationId + '.json');
    await atomicWriteJson(journal, { schemaVersion: 1, operation: 'remove', planId: approved.planId,
      descriptorId: approved.descriptorId, original: verified.root, retired, state: 'approved-owned-removal' }, { mkdir: true });
    await fs.rename(path.join(selected.owner, 'current.json'), retainedSelector);
    try { await fs.rename(verified.root, retired); }
    catch (error) { await fs.rename(retainedSelector, path.join(selected.owner, 'current.json')); throw error; }
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

export const removePinnedManagedTool = async approved => {
  if (!path.isAbsolute(approved?.toolingRoot || '')) throw new Error('Managed removal requires its absolute tooling owner.');
  const categoryLease = acquireRepoCacheAccessLease(approved.toolingRoot, accessOptions(approved.toolingRoot));
  let primaryError = null;
  try { return await removeOwnedManagedTool(approved); }
  catch (error) { primaryError = error; throw error; }
  finally {
    if (!categoryLease.release()) {
      const cleanupError = new Error('Managed removal category lease changed before release.');
      if (!primaryError) throw cleanupError;
      primaryError.managedCleanupError = cleanupError;
    }
  }
};
