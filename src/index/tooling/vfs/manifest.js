import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { checksumString } from '../../../shared/hash.js';
import { fromPosix } from '../../../shared/files.js';
import { decodeBloomFilter } from '../../../shared/bloom.js';
import { readJsonFile } from '../../../shared/artifact-io.js';
import { VFS_MANIFEST_HASH_MAX_BYTES } from './constants.js';

const resolveVfsManifestSource = (indexDir) => {
  if (!indexDir) return null;
  const candidates = [
    path.join(indexDir, 'vfs_manifest.jsonl'),
    path.join(indexDir, 'vfs_manifest.jsonl.gz'),
    path.join(indexDir, 'vfs_manifest.jsonl.zst')
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return { type: 'single', path: candidate };
    }
  }
  const metaPath = path.join(indexDir, 'vfs_manifest.meta.json');
  if (!fs.existsSync(metaPath)) return null;
  let meta = null;
  try {
    meta = readJsonFile(metaPath);
  } catch {
    return null;
  }
  const parts = Array.isArray(meta?.parts) ? meta.parts : [];
  if (!parts.length) return null;
  const partNames = parts
    .map((part) => part?.path)
    .filter((value) => typeof value === 'string' && value.trim());
  if (!partNames.length) return null;
  const partPaths = partNames.map((partName) => path.join(indexDir, fromPosix(partName)));
  return { type: 'sharded', partNames, partPaths };
};

const hashManifestFile = async (filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return null;
  let stat = null;
  try {
    stat = await fsPromises.stat(filePath);
  } catch {
    return null;
  }
  if (stat.size > VFS_MANIFEST_HASH_MAX_BYTES) return null;
  const buffer = await fsPromises.readFile(filePath);
  const hash = await checksumString(buffer);
  return hash?.value ? `xxh64:${hash.value}` : null;
};

/**
 * Load a VFS manifest bloom filter from disk.
 * @param {{bloomPath:string}} input
 * @returns {Promise<object|null>}
 */
export const loadVfsManifestBloomFilter = async ({ bloomPath }) => {
  if (!bloomPath || !fs.existsSync(bloomPath)) return null;
  const raw = readJsonFile(bloomPath);
  return decodeBloomFilter(raw);
};

/**
 * Compute a deterministic hash for the VFS manifest contents.
 * @param {{indexDir:string}} input
 * @returns {Promise<string|null>}
 */
export const computeVfsManifestHash = async ({ indexDir }) => {
  const source = resolveVfsManifestSource(indexDir);
  if (!source) return null;
  if (source.type === 'single') {
    return hashManifestFile(source.path);
  }
  if (source.type === 'sharded') {
    const parts = [];
    for (let i = 0; i < source.partPaths.length; i += 1) {
      const partPath = source.partPaths[i];
      const hashValue = await hashManifestFile(partPath);
      if (!hashValue) return null;
      const name = source.partNames[i] || path.basename(partPath);
      parts.push(`${name}:${hashValue.replace(/^xxh64:/, '')}`);
    }
    const combined = await checksumString(parts.join('|'));
    return combined?.value ? `xxh64:${combined.value}` : null;
  }
  return null;
};
