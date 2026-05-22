import crypto from 'node:crypto';
import fsPromises from 'node:fs/promises';
import { atomicWriteText } from '../io/atomic-write.js';
import { getCasMetaPath, getCasObjectPath, normalizeCasHash } from './paths.js';
import { readCasMetadata, writeCasMetadata } from './metadata.js';
import { fileExists, toIsoString } from './support.js';

export const computeCasHash = (payload) => {
  const source = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  return crypto.createHash('sha256').update(source).digest('hex');
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
  const existing = await readCasMetadata(cacheRoot, hash);
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
  await writeCasMetadata(cacheRoot, hash, next);
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
  const existing = await readCasMetadata(cacheRoot, hash);
  if (!existing || typeof existing !== 'object') return false;
  const next = {
    ...existing,
    hash,
    lastAccessedAt: toIsoString(now)
  };
  await writeCasMetadata(cacheRoot, hash, next);
  return true;
};
