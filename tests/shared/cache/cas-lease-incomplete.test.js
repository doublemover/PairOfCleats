import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readActiveCasLeases } from '../../../src/shared/cache-cas/leases.js';
import { getCasLeasesRoot } from '../../../src/shared/cache-cas/paths.js';
import { prepareTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareTestCacheDir('cas-lease-incomplete');
const leasesRoot = getCasLeasesRoot(dir);
const activeHash = 'a'.repeat(64), expiredHash = 'b'.repeat(64), invalidHash = 'c'.repeat(64);
const invalidPath = path.join(leasesRoot, `${invalidHash}.json`);
const originalReaddir = fs.readdir;
try {
  await fs.mkdir(leasesRoot, { recursive: true });
  await fs.writeFile(path.join(leasesRoot, `${activeHash}.json`), JSON.stringify({ startedAt: new Date(0).toISOString(), ttlMs: 2000 }));
  await fs.writeFile(path.join(leasesRoot, `${expiredHash}.json`), JSON.stringify({ startedAt: new Date(0).toISOString(), ttlMs: 500 }));
  assert.deepEqual(await readActiveCasLeases(dir, 1000), new Set([activeHash]));
  for (const payload of ['{broken', '{}', '{"ttlMs":null,"startedAt":"bad"}']) {
    await fs.writeFile(invalidPath, payload);
    await assert.rejects(readActiveCasLeases(dir, 1000), (error) => error.code === 'ERR_CAS_LEASE_INCOMPLETE'
      && error.leaseFailure.hash === invalidHash && error.leaseFailure.path === invalidPath);
  }
  await fs.rm(invalidPath);
  for (const code of ['EACCES', 'EIO']) {
    fs.readdir = async (target, ...args) => {
      if (path.resolve(String(target)) === leasesRoot) throw Object.assign(new Error(code), { code });
      return originalReaddir(target, ...args);
    };
    await assert.rejects(readActiveCasLeases(dir), (error) => error.code === 'ERR_CAS_LEASE_INCOMPLETE'
      && error.leaseFailure.code === code);
  }
} finally {
  fs.readdir = originalReaddir;
  await fs.rm(dir, { recursive: true, force: true });
}
console.log('CAS lease incomplete inventory test passed');
