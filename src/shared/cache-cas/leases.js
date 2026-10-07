import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { getCasLeasesRoot, normalizeCasHash } from './paths.js';
import { CAS_ENUM_CONCURRENCY, fileExists, readJsonIfExists, runWithConcurrency } from './support.js';

const isActiveLease = (lease, nowMs) => {
  if (!lease || typeof lease !== 'object') return false;
  const ttlMs = Number(lease.ttlMs);
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) return false;
  const started = Date.parse(lease.startedAt);
  if (!Number.isFinite(started)) return false;
  return nowMs < started + ttlMs;
};

export const readActiveCasLeases = async (cacheRoot, now = Date.now()) => {
  const nowMs = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const leasesRoot = getCasLeasesRoot(cacheRoot);
  if (!fileExists(leasesRoot)) return new Set();
  const entries = await fsPromises.readdir(leasesRoot, { withFileTypes: true });
  const active = new Set();
  const leaseFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json'));
  const activeHashes = await runWithConcurrency(leaseFiles, CAS_ENUM_CONCURRENCY, async (entry) => {
    const hash = normalizeCasHash(entry.name.slice(0, -'.json'.length));
    if (!hash) return null;
    const lease = await readJsonIfExists(path.join(leasesRoot, entry.name));
    if (!isActiveLease(lease, nowMs)) return null;
    return hash;
  });
  for (const hash of activeHashes) {
    if (hash) active.add(hash);
  }
  return active;
};
