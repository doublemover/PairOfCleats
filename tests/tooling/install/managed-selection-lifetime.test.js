// UNVALIDATED: actual read/Dir/storage owners with inert canonical receipts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { stableStringify } from '../../../src/shared/stable-json.js';
import { resolveManagedGoSdk } from '../../../src/shared/managed-go.js';
import { readManagedLuaSelection, resolveManagedLuaLanguageServer } from '../../../src/shared/managed-lua.js';
import { resolveManagedToolInstallation } from '../../../src/shared/managed-installation.js';
import { inspectManagedInstallationSync, retainManagedToolInstallationSync } from '../../../src/shared/managed-installation-retain.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { getStorageDirectorySession } from '../../../src/shared/storage/directory.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { repoAccessPaths } from '../../../src/shared/cache/repo-access.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('managed-selection-lifetime/')[1];
assert.ok(['go-selection', 'lua-selection', 'lua-discovery', 'managed-selection', 'inspect-selection', 'inspect-file',
  'inspect-directory-read', 'inspect-directory-close', 'retained-first-selection', 'retained-second-selection',
  'retained-file', 'retained-directory-read', 'retained-directory-close', 'retained-metadata', 'original-directory-close', 'positive'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`managed-selection-${selected}`);
const home = path.join(dir, 'home'), toolingRoot = path.join(dir, 'tooling'), toolId = 'fixture-lifetime';
const owner = path.join(toolingRoot, 'installs', toolId), installId = 'a'.repeat(64);
const generation = path.join(owner, 'generations', installId), command = path.join(generation, 'bin', 'tool');
const hash = value => createHash('sha256').update(value).digest('hex');
const identity = value => hash(stableStringify(value));
const archive = { url: 'https://fixture.invalid/archive.zip', type: 'zip', bytes: 1, sha256: 'b'.repeat(64) };
const descriptor = { schemaVersion: 1, toolId, recipeId: 'explicit-inert-fixture', version: '1',
  platform: process.platform, arch: process.arch, archive, root: 'package', command: 'bin/tool', args: [], requiredFiles: ['bin/tool'] };
const descriptorId = identity(descriptor), selector = { schemaVersion: 1, toolId, descriptorId, installId };
const bytes = 'inert managed consumer bytes';
const files = [{ path: 'bin/tool', bytes: Buffer.byteLength(bytes), sha256: hash(bytes) }];
const receipt = { schemaVersion: 1, application: 'pairofcleats', toolId, descriptorId, installId, descriptor,
  root: generation, source: archive, files, filesIdentity: identity(files), selectorIdentity: identity(selector),
  verification: { ok: true, settlement: { resourceId: 'inert-verifier', settled: true, pending: false } },
  installedAt: '2026-10-27T00:00:00.000Z', ownership: 'managed', leaseProtocol: 'storage-asset-access-v1' };
fs.mkdirSync(path.dirname(command), { recursive: true }); fs.writeFileSync(command, bytes);
fs.mkdirSync(path.join(owner, 'receipts')); fs.writeFileSync(path.join(owner, 'receipts', `${installId}.json`), JSON.stringify(receipt));
let selectionPath = path.join(owner, 'current.json');
fs.writeFileSync(selectionPath, JSON.stringify(selector));
if (selected === 'go-selection') selectionPath = path.join(toolingRoot, 'sdk', 'go', 'current.json');
if (selected.startsWith('lua-')) selectionPath = path.join(toolingRoot, 'servers', 'lua-language-server', 'current.json');
fs.mkdirSync(path.dirname(selectionPath), { recursive: true });
if (!fs.existsSync(selectionPath)) fs.writeFileSync(selectionPath, '{}');
applyTestEnv({ cacheRoot: path.join(dir, 'cache'), extraEnv: { PAIROFCLEATS_HOME: home, PAIROFCLEATS_TRUSTED_CONFIG: null } });
const coordinationRoot = path.join(home, 'state', 'storage-access');
const categoryLeases = repoAccessPaths(toolingRoot, { coordinationRoot }).leases;
const open = fs.openSync, read = fs.readSync, close = fs.closeSync, opendir = fs.opendirSync, remove = fs.rmSync;
const targetFds = new Set(), actualDirectories = new Set();
let selectionOpens = 0, ready = false, fileReads = 0, fileCloses = 0, directoryReads = 0, directoryCloses = 0;
let pending = null, metadataDenied = selected === 'retained-metadata';
const original = Object.freeze(Object.assign(new Error('frozen original managed inspection read remains pending'), {
  cacheOwnershipReleased() { assert.equal(this, original); return ready; }
}));
const directoryFailure = Object.freeze(Object.assign(new Error('frozen original synchronous Dir close failed'), { code: 'EIO' }));
const recover = () => {
  if (!pending) return;
  if (pending.managedInspectionSession) return pending.managedInspectionSession.releaseAfterClosure();
  const file = getContainedFileSession(pending), directory = getStorageDirectorySession(pending);
  file?.releaseAfterCloseSync(); directory?.releaseAfterCloseSync();
};
try {
  fs.openSync = (target, ...args) => {
    const fd = open(target, ...args);
    if (target === selectionPath) selectionOpens++;
    const second = selected === 'retained-second-selection' && selectionOpens === 2;
    if ((target === selectionPath && !selected.includes('file') && (!selected.startsWith('retained-second-') || second)
      && !selected.includes('directory') && !['positive', 'retained-metadata'].includes(selected))
      || target === command && (selected.endsWith('-file') || selected === 'retained-metadata')) targetFds.add(fd);
    return fd;
  };
  fs.readSync = (fd, ...args) => { if (targetFds.has(fd)) { fileReads++; throw original; } return read(fd, ...args); };
  fs.closeSync = fd => { const result = close(fd); if (targetFds.delete(fd)) fileCloses++; return result; };
  fs.opendirSync = (target, ...args) => {
    const actual = opendir(target, ...args);
    if (target !== path.dirname(command) || !selected.includes('directory')) return actual;
    actualDirectories.add(actual);
    const owned = {
      readSync() {
        assert.equal(this, owned); directoryReads++;
        if (selected.endsWith('directory-read')) throw original;
        if (selected === 'original-directory-close') owned.closeSync = () => assert.fail('a replacement close cannot own the original Dir');
        return actual.readSync();
      },
      closeSync() {
        assert.equal(this, owned); directoryCloses++;
        if (selected.endsWith('directory-close') && selected !== 'original-directory-close' && !ready) throw directoryFailure;
        const result = actual.closeSync(); actualDirectories.delete(actual); return result;
      }
    };
    return owned;
  };
  fs.rmSync = (target, ...args) => {
    if (metadataDenied && path.dirname(String(target)) === categoryLeases) throw Object.assign(new Error('controlled inspection metadata unlink'), { code: 'EACCES' });
    return remove(target, ...args);
  };
  const options = { toolingRoot, toolId };
  const invoke = () => {
    if (selected === 'go-selection') return resolveManagedGoSdk(toolingRoot);
    if (selected === 'lua-selection') return readManagedLuaSelection(toolingRoot);
    if (selected === 'lua-discovery') return resolveManagedLuaLanguageServer(toolingRoot);
    if (selected === 'managed-selection') return resolveManagedToolInstallation(toolingRoot, toolId);
    if (selected.startsWith('retained-') || selected === 'positive') return retainManagedToolInstallationSync(options);
    return inspectManagedInstallationSync(options);
  };
  if (['positive', 'original-directory-close'].includes(selected)) {
    const result = invoke(); assert.equal(result.ok, true); assert.equal(result.command, command);
    if (selected === 'positive') {
      assert.equal((await inspectStorageAccess(toolingRoot, { coordinationRoot })).protected, true);
      assert.equal(result.release(), true);
      assert.equal((await inspectStorageAccess(toolingRoot, { coordinationRoot })).protected, false);
    } else assert.equal(directoryCloses, 1);
    assert.equal(actualDirectories.size, 0);
  } else {
    assert.throws(invoke, error => { pending = error; return error.cacheOwnershipPending === true
      && errorGraphIncludes(error, selected.endsWith('directory-close') ? directoryFailure : original); });
    const retained = selected.startsWith('retained-');
    if (retained) assert.equal((await inspectStorageAccess(toolingRoot, { coordinationRoot })).protected, true,
      'the first inspection and repeated selection check both occur under storage protection');
    assert.throws(recover);
    if (retained) assert.equal((await inspectStorageAccess(toolingRoot, { coordinationRoot })).protected, true);
    ready = true;
    if (metadataDenied) {
      assert.throws(recover); assert.equal((await inspectStorageAccess(toolingRoot, { coordinationRoot })).protected, true);
      metadataDenied = false;
    }
    const readsBefore = fileReads, directoryBefore = directoryReads;
    recover();
    assert.equal(pending.cacheOwnershipReleased(), true);
    assert.equal(fileReads, readsBefore); assert.equal(directoryReads, directoryBefore, 'recovery never resumes directory enumeration');
    assert.equal(targetFds.size, 0); assert.equal(actualDirectories.size, 0);
    if (retained) assert.equal((await inspectStorageAccess(toolingRoot, { coordinationRoot })).protected, false);
    if (!selected.endsWith('directory-close') && !selected.endsWith('directory-read')) assert.equal(fileCloses, 1);
    pending = null;
  }
} finally {
  fs.openSync = open; fs.readSync = read; fs.closeSync = close; fs.opendirSync = opendir; fs.rmSync = remove;
  ready = true; metadataDenied = false;
  recover();
  for (const fd of targetFds) close(fd);
  for (const handle of actualDirectories) handle.closeSync();
  remove(dir, { recursive: true, force: true });
}
console.log(`Managed selection ${selected}: original resource/metadata ownership, inert fixture only.`);
