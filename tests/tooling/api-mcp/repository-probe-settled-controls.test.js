import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRepoCacheManager } from '../../../src/shared/repo-cache-config.js';
import { createRepoCacheManager as createApiManager } from '../../../tools/api/router/cache.js';
import { resolveRepoPath } from '../../../tools/mcp/repo.js';
import { getRepoCacheRoot, loadUserConfig } from '../../../src/shared/dict-utils.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const surface = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['shared', 'api', 'mcp'].includes(surface));
const { dir } = await prepareIsolatedTestCacheDir('repository-probe-settled-' + surface);
const repo = path.join(dir, 'repo'), child = path.join(repo, 'nested');
applyTestEnv({ cacheRoot: path.join(dir, 'cache'), extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
const key = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const originalOpen = fs.openSync, originalClose = fs.closeSync;
const descriptors = new Set(); let opened = 0, closed = 0, manager;
try {
  await fsp.mkdir(child, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repo, windowsHide: true, stdio: 'ignore' });
  const parentArtifacts = getRepoCacheRoot(repo, loadUserConfig(repo));
  const childArtifacts = getRepoCacheRoot(child, loadUserConfig(child));
  if (surface !== 'mcp') manager = (surface === 'api' ? createApiManager : createRepoCacheManager)({ defaultRepo: repo });
  const resolve = candidate => surface === 'mcp' ? resolveRepoPath(candidate) : manager.getRepoCaches(candidate).repoRoot;
  fs.openSync = (filename, ...args) => {
    const fd = originalOpen(filename, ...args);
    if (key(filename) === key(path.join(child, '.pairofcleats.json')) || key(filename) === key(path.join(repo, '.pairofcleats.json'))) {
      descriptors.add(fd); opened++;
    }
    return fd;
  };
  fs.closeSync = fd => { const result = originalClose(fd); if (descriptors.delete(fd)) closed++; return result; };
  assert.equal(key(resolve(child)), key(repo), 'missing optional configurations and absent artifacts preserve fallback');
  assert.equal(descriptors.size, 0);
  await fsp.writeFile(path.join(repo, '.pairofcleats.json'), '{}');
  await fsp.writeFile(path.join(child, '.pairofcleats.json'), '{ invalid JSON');
  await fsp.mkdir(path.join(childArtifacts, 'index-code'), { recursive: true });
  assert.equal(key(resolve(child)), key(repo), 'confirmed-close malformed child config follows settled negative-probe policy');
  assert.equal(descriptors.size, 0); assert.equal(opened, closed);
  await fsp.writeFile(path.join(child, '.pairofcleats.json'), '{}');
  assert.equal(key(resolve(child)), key(child), 'healthy child is admitted after settled ancestor absence');
  await fsp.mkdir(path.join(parentArtifacts, 'index-code'), { recursive: true });
  assert.equal(key(resolve(child)), key(surface === 'mcp' ? repo : child), 'dual-healthy precedence is surface-owned');
  await fsp.writeFile(path.join(repo, '.pairofcleats.json'), '{ invalid JSON');
  assert.equal(key(resolve(child)), key(child), 'settled malformed ancestor cannot suppress healthy explicit child');
  assert.equal(descriptors.size, 0); assert.equal(opened, closed);
} finally {
  fs.openSync = originalOpen; fs.closeSync = originalClose; manager?.closeRepoCaches();
  for (const fd of descriptors) { try { originalClose(fd); } catch {} }
  await fsp.rm(dir, { recursive: true, force: true });
}
console.log('Repository probes retain settled optional/malformed policy and surface precedence.');
