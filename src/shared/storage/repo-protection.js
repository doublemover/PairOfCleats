import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { assertSafeCacheDeletion, CACHE_OWNER_FILE } from '../cache-deletion.js';
import { assertNoSymlinkPath, readVerifiedContainedFile } from '../contained-file.js';
import { classifyGeneratedArtifactCachePrefix, isGeneratedCacheMetadata } from '../generated-artifact-cache.js';
import { removeToolingCacheEntry } from '../../index/tooling/cache-storage.js';
import { stableStringify } from '../stable-json.js';
import { inspectStorageInventory, sameStorageFileIdentity, storageFileIdentity } from './inventory.js';
import { describeStorageFailure } from './failure-observation.js';

const EVIDENCE = new Set(['triage', 'snapshots', 'diffs', 'metrics', 'logs', 'recovery', 'reports',
  'recordings', 'history', 'state', 'pins', '.pins']);
const canonicalRepoId = /^[a-z0-9][a-z0-9-]{0,23}-[a-f0-9]{12}$/u;
const normalize = target => process.platform === 'win32' ? path.resolve(target).toLowerCase() : path.resolve(target);
const fingerprint = value => createHash('sha256').update(stableStringify(value)).digest('hex');
const reason = (code, target, message = null) => ({ code, path: target, ...(message ? { message } : {}) });

const qualifyGeneratedFile = async (root, file, { maxBytes = 8 * 1024 * 1024 } = {}) => {
  const target = path.join(root, file.relativePath);
  const verified = await readVerifiedContainedFile(root, target, { maxBytes,
    expectedBytes: file.identity.size, expectedFileIdentity: { dev: file.identity.dev, ino: file.identity.ino } });
  const identity = storageFileIdentity(await fs.lstat(target, { bigint: true }));
  if (identity.nlink !== 1 || !sameStorageFileIdentity(identity, file.identity)) throw new Error('Generated-file identity changed or is shared.');
  const value = JSON.parse(verified.buffer.toString('utf8'));
  let artifact;
  if (file.relativePath === CACHE_OWNER_FILE) {
    if (Object.keys(value).sort().join(',') !== 'layoutVersion,owner' || value.owner !== 'pairofcleats' || value.layoutVersion !== 1) {
      throw new Error('Repository ownership marker contains unqualified fields.');
    }
    artifact = 'storage-owner-marker';
  } else {
    const header = classifyGeneratedArtifactCachePrefix({ relativePath: file.relativePath, prefix: verified.buffer });
    if (!header || !isGeneratedCacheMetadata(value.__poc_generated) || value.__poc_generated.artifact !== header.artifact) {
      throw new Error('File lacks its registered generated-cache producer ownership.');
    }
    if (value.pinned === true || value.forensic === true || ['pinned', 'forensic'].includes(value.retention?.tier)) {
      throw new Error('Generated file carries explicit pin/forensic retention.');
    }
    artifact = header.artifact;
  }
  return { relativePath: file.relativePath, identity, sha256: verified.hash,
    logicalBytes: identity.size, artifact, stat: verified.stat };
};

/** Whole-repo legacy GC can remove only a completely proven disposable set.
 * Names, age, no readers, --force and an app-container marker are insufficient.
 */
export const inspectRepoStorageProtection = async ({ repoCacheRoot, cacheRoot, expected = null,
  maxEntries = 10000, maxBytes = 64 * 1024 * 1024, maxDurationMs = 10000, signal = null } = {}) => {
  const reasons = [];
  const started = Date.now();
  let root;
  try {
    root = assertSafeCacheDeletion(repoCacheRoot, [cacheRoot]);
    const parent = assertSafeCacheDeletion(cacheRoot, [cacheRoot]);
    const id = path.basename(root);
    if (!canonicalRepoId.test(id) || normalize(root) !== normalize(path.join(parent, 'repos', id))) {
      throw new Error('Legacy repo cleanup requires the exact canonical repos/<repoId> root.');
    }
  } catch (error) { return { protected: true, complete: false, root: path.resolve(repoCacheRoot),
    reasons: [reason('unproven-canonical-storage-authority', repoCacheRoot,
      describeStorageFailure(error, { phase: 'repo-storage-authority' }).message)] }; }
  const inventory = await inspectStorageInventory({ roots: [{ id: 'repo-cleanup', path: root }],
    includeFiles: true, maxEntries, maxDurationMs, signal });
  const item = inventory.items[0];
  if (!inventory.complete || item.status !== 'scanned' || !item.directories.length) {
    return { protected: true, complete: false, root, identity: item.identity,
      reasons: [reason('incomplete-or-unreadable-repo-inventory', root)], errors: inventory.errors };
  }
  if (expected && !sameStorageFileIdentity(expected.identity, item.identity)) reasons.push(reason('repo-identity-changed-since-plan', root));
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || !Number.isSafeInteger(item.logicalBytes)
    || item.logicalBytes > maxBytes) reasons.push(reason('repo-qualification-byte-budget', root));
  const directories = item.directories;
  const files = [];
  for (const entry of [...directories, ...item.files]) {
    if (entry.relativePath.split(/[\\/]/u).some(part => EVIDENCE.has(part.toLowerCase()))) {
      reasons.push(reason('saved-pinned-or-forensic-evidence-namespace', path.join(root, entry.relativePath)));
    }
  }
  if (!reasons.length) {
    for (const file of item.files) {
      if (signal?.aborted || Date.now() - started >= maxDurationMs) {
        reasons.push(reason('repo-qualification-incomplete-or-cancelled', root));
        break;
      }
      try { files.push(await qualifyGeneratedFile(root, file, { maxBytes: Math.min(maxBytes, 8 * 1024 * 1024) })); }
      catch (error) { reasons.push(reason('unknown-unreadable-or-retained-file', path.join(root, file.relativePath),
        describeStorageFailure(error, { phase: 'repo-storage-file-qualification' }).message)); }
    }
    for (const directory of directories) {
      if (!directory.relativePath || directory.relativePath === 'locks') continue;
      const prefix = `${directory.relativePath}${path.sep}`;
      if (!files.some(file => file.relativePath.startsWith(prefix))) {
        reasons.push(reason('unknown-empty-directory-ownership', path.join(root, directory.relativePath)));
      }
    }
  }
  const receipt = { root, identity: item.identity,
    files: files.map(({ stat, ...file }) => { void stat; return file; }), directories,
    logicalBytes: Number.isSafeInteger(item.logicalBytes) ? item.logicalBytes : null };
  const proof = fingerprint(receipt);
  if (expected && expected.proof !== proof) reasons.push(reason('repo-owned-file-set-changed-since-plan', root));
  return { ...receipt, proof, protected: reasons.length > 0, complete: true, reasons,
    authority: 'registered-generated-file-producers-only',
    unqualified: 'full indexes/builds/mixed roots require their category manifest owner' };
};

/** Caller holds the existing repo exclusion. Delete exact proven producer files
 * through the existing file owner; rmdir only empty exact directories. A late
 * ordinary file makes rmdir fail and is never included in recursive removal.
 */
export const removeDerivedRepoCache = async (expected, { cacheRoot, hooks = {} } = {}) => {
  const current = await inspectRepoStorageProtection({ repoCacheRoot: expected.root, cacheRoot, expected });
  if (current.protected || !current.complete) return { ok: false, attempts: 0, deletedLogicalBytes: 0,
    error: { code: 'ERR_REPO_STORAGE_PROTECTED', message: 'Repository evidence/ownership changed inside exclusion.' }, reasons: current.reasons };
  let deletedLogicalBytes = 0;
  const deletedFiles = [];
  try {
    await hooks.afterRevalidation?.(current);
    for (const file of current.files) {
      assertSafeCacheDeletion(path.join(current.root, file.relativePath), [cacheRoot]);
      const qualified = await qualifyGeneratedFile(current.root, file);
      if (qualified.sha256 !== file.sha256) throw new Error('Generated file content changed after revalidation.');
      if (!removeToolingCacheEntry(path.join(current.root, file.relativePath), qualified.stat)) throw new Error('Generated-file removal owner rejected a changed identity.');
      deletedLogicalBytes += qualified.logicalBytes;
      deletedFiles.push(file.relativePath);
    }
    for (const directory of [...current.directories].sort((a, b) => b.relativePath.length - a.relativePath.length)) {
      const target = path.join(current.root, directory.relativePath);
      assertSafeCacheDeletion(target, [cacheRoot]);
      assertNoSymlinkPath(current.root, target);
      const stat = await fs.lstat(target, { bigint: true });
      if (!stat.isDirectory() || String(stat.dev) !== directory.identity.dev || String(stat.ino) !== directory.identity.ino) {
        throw new Error('Repository directory identity changed before empty-directory removal.');
      }
      await fs.rmdir(target);
    }
    return { ok: true, attempts: 1, deletedLogicalBytes, deletedFiles, actualReclaimedBytes: null };
  } catch (error) { return { ok: false, attempts: 1, deletedLogicalBytes, deletedFiles,
    actualReclaimedBytes: null, error: describeStorageFailure(error,
      { phase: 'repo-storage-removal', defaultCode: 'ERR_REPO_STORAGE_CHANGED' }) }; }
};
