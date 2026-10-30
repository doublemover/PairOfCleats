import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { getCasLeasesRoot, normalizeCasHash } from './paths.js';
import { CAS_ENUM_CONCURRENCY, runWithConcurrency } from './support.js';
import { readVerifiedContainedFile } from '../contained-file.js';

const incompleteLease = (targetPath, hash, cause) => Object.assign(
  new Error(`CAS deletion deferred: lease inventory is incomplete at ${targetPath}.`, { cause }),
  { code: 'ERR_CAS_LEASE_INCOMPLETE', leaseFailure: {
    path: targetPath, hash, code: cause?.code || 'ERR_CAS_LEASE_INVALID', message: cause?.message || String(cause)
  } }
);

const isActiveLease = (lease, nowMs) => {
  if (!lease || typeof lease !== 'object' || Array.isArray(lease)) throw new Error('CAS lease must be an object.');
  const ttlMs = lease.ttlMs;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('CAS lease ttlMs is invalid.');
  const started = Date.parse(lease.startedAt);
  if (!Number.isFinite(started) || !Number.isSafeInteger(started + ttlMs)) throw new Error('CAS lease startedAt or expiry is invalid.');
  return nowMs < started + ttlMs;
};

export const readActiveCasLeases = async (cacheRoot, now = Date.now()) => {
  const nowMs = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const leasesRoot = getCasLeasesRoot(cacheRoot);
  let entries;
  try { entries = await fsPromises.readdir(leasesRoot, { withFileTypes: true }); }
  catch (error) {
    if (error?.code === 'ENOENT') return new Set();
    throw incompleteLease(leasesRoot, null, error);
  }
  const active = new Set();
  const leaseFiles = entries.filter((entry) => entry.name.endsWith('.json'));
  const activeHashes = await runWithConcurrency(leaseFiles, CAS_ENUM_CONCURRENCY, async (entry) => {
    const hash = normalizeCasHash(entry.name.slice(0, -'.json'.length));
    if (!hash) return null;
    const targetPath = path.join(leasesRoot, entry.name);
    try {
      if (!entry.isFile()) throw new Error('CAS lease is not an ordinary file.');
      const { buffer } = await readVerifiedContainedFile(leasesRoot, targetPath, { maxBytes: 2 * 1024 * 1024 });
      const lease = JSON.parse(buffer.toString('utf8'));
      return isActiveLease(lease, nowMs) ? hash : null;
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw incompleteLease(targetPath, hash, error);
    }
  });
  for (const hash of activeHashes) {
    if (hash) active.add(hash);
  }
  return active;
};
