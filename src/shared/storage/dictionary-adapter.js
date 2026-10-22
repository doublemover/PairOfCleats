import fs from 'node:fs/promises';
import path from 'node:path';
import { readVerifiedContainedFile } from '../contained-file.js';
import { isPathWithinRoot } from '../file-paths.js';
import { CACHE_OWNER_FILE } from '../cache-deletion.js';
import { CODE_DICT_DIR_NAME } from '../code-dictionaries.js';
import { inspectStorageInventory } from './inventory.js';
import { inspectStorageAccess } from './access.js';
import { verifyStorageFile } from './transfer.js';
import { storagePlanDigest } from './migration-plan.js';

const safeName = name => /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/u.test(name) && name !== '..';
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const directoryKind = relative => relative === '' || ['slang', 'repos', CODE_DICT_DIR_NAME].includes(relative)
  || (relative.startsWith(`${CODE_DICT_DIR_NAME}/`) && relative.split('/').length === 2 && safeName(relative.split('/')[1]));
const textKind = relative => {
  const parts = relative.split('/');
  const name = parts.at(-1);
  if (!name.endsWith('.txt') || !safeName(name)) return null;
  if (parts.length === 1) return 'dictionary-text';
  if (parts.length === 2 && parts[0] === 'repos') return 'durable-repository-dictionary';
  if (parts.length === 2 && parts[0] === 'slang') return 'durable-user-slang';
  if (parts[0] === CODE_DICT_DIR_NAME && (parts.length === 2 || (parts.length === 3 && safeName(parts[1])))) return 'durable-code-dictionary';
  return null;
};
const validateManifest = value => {
  if (!record(value)) throw new Error('Dictionary manifest must be a complete named-source object.');
  const keys = ['url', 'file', 'sha256', 'verified', 'etag', 'lastModified', 'downloadedAt'].sort().join(',');
  for (const [name, entry] of Object.entries(value)) {
    if (!safeName(name) || !record(entry) || Object.keys(entry).sort().join(',') !== keys
      || typeof entry.url !== 'string' || !/^https?:\/\//u.test(entry.url)
      || typeof entry.file !== 'string' || path.basename(entry.file) !== entry.file || !textKind(entry.file)
      || typeof entry.verified !== 'boolean' || (entry.sha256 !== null && !/^[a-f0-9]{64}$/u.test(entry.sha256))
      || (entry.verified && entry.sha256 === null) || (entry.etag !== null && typeof entry.etag !== 'string')
      || (entry.lastModified !== null && typeof entry.lastModified !== 'string')
      || typeof entry.downloadedAt !== 'string' || !Number.isFinite(Date.parse(entry.downloadedAt))) {
      throw new Error('Dictionary manifest contains an unknown, pinned, referenced or nonportable source entry.');
    }
  }
};

/** Complete consumer namespace: all durable repo/slang/code dictionaries are
 * copied and retained. This is migration authority, never cleanup authority.
 */
export const inspectDictionaryStorage = async ({ root, maxEntries = 10000, maxDurationMs = 10000, signal = null } = {}) => {
  const inventory = await inspectStorageInventory({ roots: [{ id: 'dictionaries', category: 'dictionaries', path: root,
    retention: 'mixed-durable-and-downloadable' }], includeFiles: true, maxEntries, maxDurationMs, signal });
  const item = inventory.items[0];
  if (!inventory.complete || item.status !== 'scanned') throw new Error('Dictionary category inventory is missing, unreadable or incomplete.');
  const manifestFile = item.files.find(file => file.relativePath === 'dictionaries.json');
  if (!manifestFile) throw new Error('Dictionary source manifest is missing; arbitrary text directories are not adopted.');
  const manifestRead = await readVerifiedContainedFile(root, path.join(root, manifestFile.relativePath), { maxBytes: 1024 * 1024 });
  const manifest = JSON.parse(manifestRead.buffer.toString('utf8'));
  validateManifest(manifest);
  const files = [];
  for (const file of item.files) {
    const relativePath = file.relativePath.split(path.sep).join('/');
    let kind = textKind(relativePath);
    if (relativePath === 'dictionaries.json') kind = 'dictionary-source-manifest';
    if (relativePath === CACHE_OWNER_FILE) {
      const marker = JSON.parse((await readVerifiedContainedFile(root, path.join(root, file.relativePath), { maxBytes: 64 * 1024 })).buffer.toString('utf8'));
      if (Object.keys(marker).sort().join(',') !== 'layoutVersion,owner' || marker.owner !== 'pairofcleats' || marker.layoutVersion !== 1) throw new Error('Unknown dictionary ownership marker is preserved.');
      kind = 'existing-category-marker';
    }
    if (!kind) throw new Error(`Unregistered dictionary bytes are preserved: ${relativePath}`);
    const verified = await verifyStorageFile({ root, file: path.join(root, file.relativePath), identity: file.identity,
      maxBytes: 256 * 1024 * 1024, signal });
    files.push({ relativePath, kind, sha256: verified.sha256, logicalBytes: verified.bytes,
      retention: kind.startsWith('durable-') ? 'durable' : 'category-owner-retained', deletionAuthority: false });
  }
  const directories = item.directories.map(directory => directory.relativePath.split(path.sep).join('/')).sort();
  if (directories.some(relative => !directoryKind(relative))) throw new Error('Unknown dictionary directory is preserved and blocks category migration.');
  const available = new Set(files.map(file => file.relativePath));
  if (Object.values(manifest).some(entry => !available.has(entry.file))) throw new Error('Dictionary manifest references absent bytes.');
  const body = { schemaVersion: 1, manifestSha256: manifestRead.hash, files: files.sort((a, b) => a.relativePath.localeCompare(b.relativePath)), directories };
  return { ...body, identity: storagePlanDigest(body), complete: true, deletionAuthority: false,
    downloadIntegrity: 'source-sidecar-preserved; migration-verifies-exact-local-consumer-bytes' };
};

const posixPermissions = async ({ source, destination, inspection }) => {
  if (process.platform === 'win32') return { compatible: false, reason: 'windows-destination-acl-owner-proof-required' };
  if (typeof process.geteuid !== 'function' || typeof process.getegid !== 'function') return { compatible: false, reason: 'platform-permission-owner-required' };
  const uid = process.geteuid(); const gid = process.getegid();
  for (const relative of [...inspection.directories, ...inspection.files.map(file => file.relativePath)]) {
    const stat = await fs.lstat(path.join(source, relative), { bigint: true });
    if (stat.uid !== BigInt(uid) || stat.gid !== BigInt(gid) || (stat.mode & 0o7000n) !== 0n) {
      return { compatible: false, reason: 'dictionary-owner-group-or-special-permissions-require-dedicated-owner' };
    }
  }
  let ancestor = destination;
  for (;;) {
    try {
      const stat = await fs.lstat(ancestor, { bigint: true });
      if ((stat.mode & 0o2000n) !== 0n && stat.gid !== BigInt(gid)) return { compatible: false, reason: 'destination-inherited-group-is-incompatible' };
      break;
    } catch (error) { if (error.code !== 'ENOENT' || path.dirname(ancestor) === ancestor) throw error; ancestor = path.dirname(ancestor); }
  }
  return { compatible: false, reason: 'extended-permission-owner-proof-required',
    metadataIdentity: `posix-mode-owner-group:${uid}:${gid}`,
    limitation: 'Mode/uid/gid observations do not establish extended ACL/xattr equivalence.' };
};

/** Actual CLI owner, scoped to its launch-selected dictionary category. Unknown
 * external/shared roots and permission semantics remain explicit blockers.
 */
export const createDictionaryMigrationOwner = ({ home, source, permissionOwner = null } = {}) => {
  if (!path.isAbsolute(home || '') || !path.isAbsolute(source || '')) throw new TypeError('Dictionary migration owner requires explicit application home and source.');
  home = path.resolve(home); source = path.resolve(source);
  const coordinationRoot = path.join(home, 'state', 'storage-access');
  return { id: 'dictionary-storage-v1', version: 1,
    inspect: async input => {
      if (input.category !== 'dictionaries' || path.resolve(input.source) !== source || path.resolve(input.home) !== home
        || path.resolve(input.coordinationRoot || coordinationRoot) !== coordinationRoot) return { complete: false, reason: 'wrong-dictionary-migration-owner' };
      if (!isPathWithinRoot(source, home)) return { complete: false, reason: 'external-or-shared-dictionary-root-requires-explicit-owner' };
      const access = await inspectStorageAccess(source, { coordinationRoot });
      const unexpected = access.owners.filter(owner => owner.protected && !(owner.role === 'cleanup'
        && input.exclusiveOwners?.some(exclusive => exclusive.root === source && exclusive.lockId === owner.lockId && exclusive.pid === process.pid)));
      if (!access.complete || unexpected.length) return { complete: false, reason: 'active-or-unknown-dictionary-resource-owner' };
      const inspection = await inspectDictionaryStorage({ root: source, ...input.limits, signal: input.signal });
      const permissions = await (permissionOwner || posixPermissions)({ source, destination: input.destination, inspection, phase: input.phase });
      if (permissions?.compatible !== true || typeof permissions.identity !== 'string' || !permissions.identity) return {
        complete: false, reason: permissions?.reason || 'dictionary-permission-owner-required'
      };
      return { complete: true, quiescent: true, referencesPortable: true, permissionsCompatible: true,
        identity: storagePlanDigest({ dictionary: inspection.identity, permissions: permissions.identity }) };
    },
    verifyDestination: async ({ plan, root, signal }) => {
      const [original, copied] = await Promise.all([inspectDictionaryStorage({ root: source, ...plan.limits, signal }),
        inspectDictionaryStorage({ root, ...plan.limits, signal })]);
      return original.identity === copied.identity;
    } };
};
