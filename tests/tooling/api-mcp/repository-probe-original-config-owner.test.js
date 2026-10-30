import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRepoCacheManager } from '../../../src/shared/repo-cache-config.js';
import { createRepoCacheManager as createApiManager } from '../../../tools/api/router/cache.js';
import { resolveRepoPath } from '../../../tools/mcp/repo.js';
import { getRepoCacheRoot, loadUserConfig } from '../../../src/shared/dict-utils.js';
import { createContainedFileResource, getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1), [surface, location, mode] = selected?.split('-') || [];
assert.ok(['shared', 'api', 'mcp'].includes(surface) && ['child', 'root'].includes(location) && ['read', 'close'].includes(mode));
const { dir } = await prepareIsolatedTestCacheDir(`repository-probe-${selected}`);
const repo = path.join(dir, 'repo'), child = path.join(repo, 'nested'), cache = path.join(dir, 'cache');
applyTestEnv({ cacheRoot: cache, extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
const originalOpen = fs.openSync, originalRead = fs.readSync, originalStat = fs.fstatSync, originalClose = fs.closeSync;
const opened = new Set(); let active = false, opens = 0, reads = 0, closes = 0, rootOpens = 0, primaryFailure, asynchronous;
const primary = Object.freeze(new Error('original config descriptor operation failed'));
const closeFailure = Object.freeze(new Error('original config descriptor close remains unknown'));
const target = path.join(location === 'child' ? child : repo, '.pairofcleats.json');
// Repository selection returns the canonical comparison spelling on Windows.
// This equivalence applies to actual native paths, never artifact labels.
const nativePathKey = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
let manager, failure, dependencyFailure;
const graph = error => {
  const queue = [error], seen = new Set(), values = [];
  while (queue.length) {
    const value = queue.pop(); if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value); values.push(value); queue.push(value.cause, ...(value.errors || []));
  }
  return values;
};
try {
  await fsp.mkdir(child, { recursive: true });
  await fsp.writeFile(path.join(repo, '.pairofcleats.json'), '{}'); await fsp.writeFile(path.join(child, '.pairofcleats.json'), '{}');
  execFileSync('git', ['init', '-q'], { cwd: repo, windowsHide: true, stdio: 'ignore' });
  const parentArtifacts = getRepoCacheRoot(repo, loadUserConfig(repo)), childArtifacts = getRepoCacheRoot(child, loadUserConfig(child));
  await fsp.mkdir(path.join(parentArtifacts, 'index-code'), { recursive: true });
  if (surface !== 'mcp') manager = (surface === 'api' ? createApiManager : createRepoCacheManager)({ defaultRepo: repo });
  const resolve = candidate => surface === 'mcp' ? resolveRepoPath(candidate) : manager.getRepoCaches(candidate).repoRoot;
  assert.equal(nativePathKey(resolve(repo)), nativePathKey(repo), 'an explicit discovered root bypasses optional selection probes');
  assert.equal(nativePathKey(resolve(child)), nativePathKey(repo), 'settled child absence retains the current ancestor fallback');
  await fsp.mkdir(path.join(childArtifacts, 'index-code'), { recursive: true });
  assert.equal(nativePathKey(resolve(child)), nativePathKey(child), 'healthy explicit child artifacts retain the repaired explicit-first policy');
  manager?.closeRepoCaches();
  if (location === 'root') await fsp.rm(childArtifacts, { recursive: true, force: true });
  if (mode === 'read') {
    const handle = await fsp.open(target, 'r'), close = handle.close.bind(handle); let permitted = false;
    handle.close = async () => { if (!permitted) throw closeFailure; return close(); };
    const owner = createContainedFileResource({ handle, sync: false });
    try { await owner.run(() => { throw primary; }); } catch (error) { dependencyFailure = error; }
    assert.ok(getContainedFileSession(dependencyFailure));
    asynchronous = { release: async () => { permitted = true; await getContainedFileSession(dependencyFailure).releaseAfterClose(); } };
    primaryFailure = dependencyFailure;
  } else primaryFailure = primary;
  fs.openSync = (filename, ...args) => {
    const fd = originalOpen(filename, ...args);
    if (active && typeof filename === 'string' && nativePathKey(filename) === nativePathKey(path.join(repo, '.pairofcleats.json'))) rootOpens++;
    if (active && typeof filename === 'string' && nativePathKey(filename) === nativePathKey(target)) { opens++; opened.add(fd); }
    return fd;
  };
  fs.fstatSync = (fd, ...args) => { if (active && mode === 'close' && opened.has(fd)) throw primaryFailure; return originalStat(fd, ...args); };
  fs.readSync = (fd, ...args) => { if (active && opened.has(fd)) { reads++; throw primaryFailure; } return originalRead(fd, ...args); };
  fs.closeSync = fd => {
    if (opened.has(fd)) { closes++; if (active && mode === 'close') throw closeFailure; opened.delete(fd); }
    return originalClose(fd);
  };
  active = true;
  assert.throws(() => resolve(child), error => { failure = error; return true; });
  assert.ok(errorGraphIncludes(failure, primary)); assert.ok(errorGraphIncludes(failure, closeFailure));
  assert.equal(opens, 1, 'failed admission is not replaced by a second config read');
  if (location === 'child') assert.equal(rootOpens, 0, 'pending child observation prevents the next root probe/cache construction');
  const sessions = [...new Set(graph(failure).map(getContainedFileSession).filter(Boolean))];
  assert.ok(sessions.length); assert.equal(failure.cacheOwnershipReleased(), false);
  const beforeReads = reads;
  active = false;
  if (mode === 'read') {
    assert.equal(closes, 0, 'dependent original resource prevents even the first config descriptor close');
    await asynchronous.release();
    for (const session of sessions) if (!session.isSettled()) session.releaseAfterCloseSync();
    assert.equal(closes, 1); assert.equal(failure.cacheOwnershipReleased(), true);
    assert.equal(reads, beforeReads, 'recovery closes the original owners without replaying selection or reads');
  } else {
    assert.equal(closes, 1);
    for (const session of sessions) assert.throws(() => session.releaseAfterCloseSync());
    assert.equal(closes, 1, 'an unknown synchronous native close is not retried by reusable fd number');
    assert.equal(failure.cacheOwnershipReleased(), false);
  }
} finally {
  active = false; await asynchronous?.release().catch(() => {});
  fs.openSync = originalOpen; fs.readSync = originalRead; fs.fstatSync = originalStat; fs.closeSync = originalClose;
  for (const fd of opened) { try { originalClose(fd); } catch {} }
  manager?.closeRepoCaches(); await fsp.rm(dir, { recursive: true, force: true });
}
console.log('Actual shared/API cache and MCP repository selection preserve original config prerequisites before fallback.');
