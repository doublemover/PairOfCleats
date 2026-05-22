import path from 'node:path';

const CAS_HASH_PATTERN = /^[a-f0-9]{64}$/;

export const normalizeCasHash = (value) => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!CAS_HASH_PATTERN.test(normalized)) return null;
  return normalized;
};

export const isCasHash = (value) => normalizeCasHash(value) != null;

export const getCasRoot = (cacheRoot) => path.join(path.resolve(cacheRoot), 'cas');
export const getCasObjectsRoot = (cacheRoot) => path.join(getCasRoot(cacheRoot), 'objects');
export const getCasMetaRoot = (cacheRoot) => path.join(getCasRoot(cacheRoot), 'meta');
export const getCasLeasesRoot = (cacheRoot) => path.join(getCasRoot(cacheRoot), 'leases');

export const getCasObjectPath = (cacheRoot, hashValue) => {
  const hash = normalizeCasHash(hashValue);
  if (!hash) throw new Error(`Invalid CAS hash: ${hashValue}`);
  return path.join(getCasObjectsRoot(cacheRoot), hash.slice(0, 2), hash.slice(2, 4), hash);
};

export const getCasMetaPath = (cacheRoot, hashValue) => {
  const hash = normalizeCasHash(hashValue);
  if (!hash) throw new Error(`Invalid CAS hash: ${hashValue}`);
  return path.join(getCasMetaRoot(cacheRoot), `${hash}.json`);
};
