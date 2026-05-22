import fsSync from 'node:fs';
import path from 'node:path';
import { pathExists } from '../file-read.js';
import { MAX_JSON_BYTES } from './constants.js';
import {
  loadPiecesManifest,
  resolveArtifactPresence
} from './manifest.js';
import { joinPathSafe } from '../path-normalize.js';

const CHUNK_META_DIRECT_CANDIDATES = [
  'chunk_meta.json',
  'chunk_meta.jsonl',
  'chunk_meta.columnar.json'
];
const MANIFEST_CHUNK_META_PARSE_MAX_BYTES = 2 * 1024 * 1024;

const hasArtifactFileSync = (targetPath) => (
  fsSync.existsSync(targetPath)
  || fsSync.existsSync(`${targetPath}.gz`)
  || fsSync.existsSync(`${targetPath}.zst`)
);

const hasArtifactFileAsync = async (targetPath) => (
  await pathExists(targetPath)
  || await pathExists(`${targetPath}.gz`)
  || await pathExists(`${targetPath}.zst`)
);

/**
 * Coarse chunk-meta manifest probe for presence checks.
 *
 * This helper is intentionally optimized for speed in status/preflight paths:
 * oversized manifests short-circuit to `true` rather than fully parsing.
 *
 * @param {string} dir
 * @returns {boolean}
 */
const hasManifestChunkMetaArtifacts = (dir) => {
  const manifestPath = path.join(dir, 'pieces', 'manifest.json');
  if (!fsSync.existsSync(manifestPath)) return false;
  try {
    const stat = fsSync.statSync(manifestPath);
    if (!stat.isFile()) return false;
    if (stat.size > MANIFEST_CHUNK_META_PARSE_MAX_BYTES) return true;
  } catch {
    return false;
  }
  try {
    const manifest = loadPiecesManifest(dir, {
      maxBytes: Math.min(MAX_JSON_BYTES, MANIFEST_CHUNK_META_PARSE_MAX_BYTES),
      strict: true
    });
    const presence = resolveArtifactPresence(dir, 'chunk_meta', {
      manifest,
      maxBytes: MAX_JSON_BYTES,
      strict: false
    });
    if (!presence || presence.format === 'missing') return false;
    if (presence.error) return false;
    if (presence.missingMeta) return false;
    if (Array.isArray(presence.missingPaths) && presence.missingPaths.length) return false;
    return Array.isArray(presence.paths) && presence.paths.length > 0;
  } catch (err) {
    if (err?.code === 'ERR_JSON_TOO_LARGE') return true;
    return false;
  }
};

const hasChunkMetaShardedSync = (dir) => (
  hasArtifactFileSync(path.join(dir, 'chunk_meta.meta.json'))
  && fsSync.existsSync(path.join(dir, 'chunk_meta.parts'))
);

const hasChunkMetaShardedAsync = async (dir) => (
  await hasArtifactFileAsync(path.join(dir, 'chunk_meta.meta.json'))
  && await pathExists(path.join(dir, 'chunk_meta.parts'))
);

const hasChunkMetaBinaryColumnarPayloadSync = (dir, metaPath) => {
  try {
    const parsed = JSON.parse(fsSync.readFileSync(metaPath, 'utf8')) || {};
    const dataName = typeof parsed?.data === 'string' ? parsed.data : 'chunk_meta.binary-columnar.bin';
    const offsetsName = typeof parsed?.offsets === 'string'
      ? parsed.offsets
      : 'chunk_meta.binary-columnar.offsets.bin';
    const lengthsName = typeof parsed?.lengths === 'string'
      ? parsed.lengths
      : 'chunk_meta.binary-columnar.lengths.varint';
    const dataPath = joinPathSafe(dir, [dataName]);
    const offsetsPath = joinPathSafe(dir, [offsetsName]);
    const lengthsPath = joinPathSafe(dir, [lengthsName]);
    if (!dataPath || !offsetsPath || !lengthsPath) return false;
    return fsSync.existsSync(dataPath)
      && fsSync.existsSync(offsetsPath)
      && fsSync.existsSync(lengthsPath);
  } catch {
    return false;
  }
};

const hasChunkMetaBinaryColumnarSync = (dir) => {
  const metaPath = path.join(dir, 'chunk_meta.binary-columnar.meta.json');
  if (fsSync.existsSync(metaPath)) {
    return hasChunkMetaBinaryColumnarPayloadSync(dir, metaPath);
  }
  if (fsSync.existsSync(`${metaPath}.gz`) || fsSync.existsSync(`${metaPath}.zst`)) {
    return true;
  }
  return false;
};

const hasChunkMetaBinaryColumnarAsync = async (dir) => {
  const metaPath = path.join(dir, 'chunk_meta.binary-columnar.meta.json');
  if (await pathExists(metaPath)) {
    return hasChunkMetaBinaryColumnarPayloadSync(dir, metaPath);
  }
  if (await pathExists(`${metaPath}.gz`) || await pathExists(`${metaPath}.zst`)) {
    return true;
  }
  return false;
};

export function hasChunkMetaArtifactsSync(dir) {
  if (!dir) return false;
  for (const relPath of CHUNK_META_DIRECT_CANDIDATES) {
    if (hasArtifactFileSync(path.join(dir, relPath))) return true;
  }
  if (hasChunkMetaShardedSync(dir)) return true;
  if (hasChunkMetaBinaryColumnarSync(dir)) return true;
  return hasManifestChunkMetaArtifacts(dir);
}

export async function hasChunkMetaArtifactsAsync(dir) {
  if (!dir) return false;
  for (const relPath of CHUNK_META_DIRECT_CANDIDATES) {
    if (await hasArtifactFileAsync(path.join(dir, relPath))) return true;
  }
  if (await hasChunkMetaShardedAsync(dir)) return true;
  if (await hasChunkMetaBinaryColumnarAsync(dir)) return true;
  return hasManifestChunkMetaArtifacts(dir);
}
