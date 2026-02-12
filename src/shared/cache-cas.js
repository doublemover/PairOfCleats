import crypto from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteText } from './io/atomic-write.js';
import { stableStringify } from './stable-json.js';

const CAS_HASH_PATTERN = /^[a-f0-9]{64}$/;

const toIsoString = (value = Date.now()) => {
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  const parsed = Number(value);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  return new Date().toISOString();
};

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

const fileExists = (targetPath) => {
  try {
    return fs.existsSync(targetPath);
  } catch {
    return false;
  }
};

const readJsonIfExists = async (targetPath) => {
  if (!fileExists(targetPath)) return null;
  try {
    const raw = await fsPromises.readFile(targetPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

export const computeCasHash = (payload) => {
  const source = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  return crypto.createHash('sha256').update(source).digest('hex');
};

export const readCasMetadata = async (cacheRoot, hashValue) => {
  const hash = normalizeCasHash(hashValue);
  if (!hash) return null;
  return readJsonIfExists(getCasMetaPath(cacheRoot, hash));
};

export const writeCasObject = async ({
  cacheRoot,
  content,
  now = Date.now(),
  refCountHint = null
}) => {
  if (!cacheRoot || typeof cacheRoot !== 'string') {
    throw new Error('writeCasObject requires cacheRoot.');
  }
  const payload = Buffer.isBuffer(content) ? content : Buffer.from(String(content ?? ''), 'utf8');
  const hash = computeCasHash(payload);
  const objectPath = getCasObjectPath(cacheRoot, hash);
  const metadataPath = getCasMetaPath(cacheRoot, hash);
  let created = false;
  if (!fileExists(objectPath)) {
    await atomicWriteText(objectPath, payload);
    created = true;
  }
  const existing = await readJsonIfExists(metadataPath);
  const stat = await fsPromises.stat(objectPath);
  const createdAt = typeof existing?.createdAt === 'string' ? existing.createdAt : toIsoString(now);
  const lastAccessedAt = toIsoString(now);
  const next = {
    hash,
    size: stat.size,
    createdAt,
    lastAccessedAt,
    refCountHint: Number.isFinite(Number(refCountHint))
      ? Math.max(0, Math.floor(Number(refCountHint)))
      : null
  };
  await atomicWriteText(metadataPath, stableStringify(next), { newline: true });
  return {
    hash,
    objectPath,
    metadataPath,
    size: stat.size,
    created
  };
};

export const touchCasObject = async (cacheRoot, hashValue, now = Date.now()) => {
  const hash = normalizeCasHash(hashValue);
  if (!hash) return false;
  const metadataPath = getCasMetaPath(cacheRoot, hash);
  const existing = await readJsonIfExists(metadataPath);
  if (!existing || typeof existing !== 'object') return false;
  const next = {
    ...existing,
    hash,
    lastAccessedAt: toIsoString(now)
  };
  await atomicWriteText(metadataPath, stableStringify(next), { newline: true });
  return true;
};

export const listCasObjectHashes = async (cacheRoot) => {
  const objectsRoot = getCasObjectsRoot(cacheRoot);
  if (!fileExists(objectsRoot)) return [];
  const out = [];
  const levelOne = await fsPromises.readdir(objectsRoot, { withFileTypes: true });
  for (const one of levelOne) {
    if (!one.isDirectory()) continue;
    const onePath = path.join(objectsRoot, one.name);
    const levelTwo = await fsPromises.readdir(onePath, { withFileTypes: true });
    for (const two of levelTwo) {
      if (!two.isDirectory()) continue;
      const twoPath = path.join(onePath, two.name);
      const objects = await fsPromises.readdir(twoPath, { withFileTypes: true });
      for (const objectEntry of objects) {
        if (!objectEntry.isFile()) continue;
        const hash = normalizeCasHash(objectEntry.name);
        if (!hash) continue;
        out.push(hash);
      }
    }
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
};

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
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.json')) continue;
    const hash = normalizeCasHash(entry.name.slice(0, -'.json'.length));
    if (!hash) continue;
    const lease = await readJsonIfExists(path.join(leasesRoot, entry.name));
    if (!isActiveLease(lease, nowMs)) continue;
    active.add(hash);
  }
  return active;
};
