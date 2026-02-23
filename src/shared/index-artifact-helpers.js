import fsSync from 'node:fs';
import path from 'node:path';
import { pathExists } from './files.js';
import {
  MAX_JSON_BYTES,
  loadPiecesManifest,
  resolveArtifactPresence
} from './artifact-io.js';

const CHUNK_META_DIRECT_CANDIDATES = [
  'chunk_meta.json',
  'chunk_meta.jsonl',
  'chunk_meta.columnar.json'
];
const MANIFEST_CHUNK_META_PARSE_MAX_BYTES = 2 * 1024 * 1024;

const OPTIONAL_ARTIFACT_MISSING_CODES = new Set([
  'ERR_MANIFEST_ENTRY_MISSING',
  'ERR_MANIFEST_MISSING',
  'ERR_ARTIFACT_PARTS_MISSING'
]);

const OPTIONAL_ARTIFACT_MISSING_PREFIXES = [
  'Missing JSON artifact:',
  'Missing JSONL artifact:',
  'Missing manifest parts for'
];

const OPTIONAL_ARTIFACT_MISSING_PATTERNS = [
  /Missing index artifact/,
  /Missing manifest entry for /
];

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
    // Keep coarse presence checks fast; oversized manifests are treated as present.
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

/**
 * Determine whether sharded chunk-meta artifacts are present.
 *
 * @param {string} dir
 * @returns {boolean}
 */
const hasChunkMetaShardedSync = (dir) => (
  hasArtifactFileSync(path.join(dir, 'chunk_meta.meta.json'))
  && fsSync.existsSync(path.join(dir, 'chunk_meta.parts'))
);

/**
 * Async variant of sharded chunk-meta presence detection.
 *
 * @param {string} dir
 * @returns {Promise<boolean>}
 */
const hasChunkMetaShardedAsync = async (dir) => (
  await hasArtifactFileAsync(path.join(dir, 'chunk_meta.meta.json'))
  && await pathExists(path.join(dir, 'chunk_meta.parts'))
);

/**
 * Validate binary-columnar sidecar availability from metadata references.
 *
 * @param {string} dir
 * @param {string} metaPath
 * @returns {boolean}
 */
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
    return fsSync.existsSync(path.join(dir, dataName))
      && fsSync.existsSync(path.join(dir, offsetsName))
      && fsSync.existsSync(path.join(dir, lengthsName));
  } catch {
    return false;
  }
};

/**
 * Detect binary-columnar chunk-meta presence (sync).
 *
 * @param {string} dir
 * @returns {boolean}
 */
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

/**
 * Detect binary-columnar chunk-meta presence (async).
 *
 * @param {string} dir
 * @returns {Promise<boolean>}
 */
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

/**
 * Coarse chunk-meta presence detection for sync preflight/status checks.
 *
 * @param {string|null|undefined} dir
 * @returns {boolean}
 */
export function hasChunkMetaArtifactsSync(dir) {
  if (!dir) return false;
  for (const relPath of CHUNK_META_DIRECT_CANDIDATES) {
    if (hasArtifactFileSync(path.join(dir, relPath))) return true;
  }
  if (hasChunkMetaShardedSync(dir)) return true;
  if (hasChunkMetaBinaryColumnarSync(dir)) return true;
  return hasManifestChunkMetaArtifacts(dir);
}

/**
 * Coarse chunk-meta presence detection for async callsites.
 *
 * @param {string|null|undefined} dir
 * @returns {Promise<boolean>}
 */
export async function hasChunkMetaArtifactsAsync(dir) {
  if (!dir) return false;
  for (const relPath of CHUNK_META_DIRECT_CANDIDATES) {
    if (await hasArtifactFileAsync(path.join(dir, relPath))) return true;
  }
  if (await hasChunkMetaShardedAsync(dir)) return true;
  if (await hasChunkMetaBinaryColumnarAsync(dir)) return true;
  return hasManifestChunkMetaArtifacts(dir);
}

/**
 * Normalize loader errors that represent optional-artifact absence.
 *
 * @param {any} err
 * @returns {boolean}
 */
export function isOptionalArtifactMissingError(err) {
  const code = typeof err?.code === 'string' ? err.code : '';
  if (OPTIONAL_ARTIFACT_MISSING_CODES.has(code)) return true;
  const message = String(err?.message || '');
  if (OPTIONAL_ARTIFACT_MISSING_PREFIXES.some((prefix) => message.startsWith(prefix))) {
    return true;
  }
  return OPTIONAL_ARTIFACT_MISSING_PATTERNS.some((pattern) => pattern.test(message));
}

export const isOptionalArtifactTooLargeError = (err) => err?.code === 'ERR_JSON_TOO_LARGE';

const handleOptionalArtifactFallback = (
  err,
  { name = null, onTooLarge = null, onMissing = null } = {}
) => {
  if (isOptionalArtifactTooLargeError(err)) {
    if (typeof onTooLarge === 'function') onTooLarge(name, err);
    return true;
  }
  if (isOptionalArtifactMissingError(err)) {
    if (typeof onMissing === 'function') onMissing(name, err);
    return true;
  }
  return false;
};

export async function loadOptionalWithFallback(
  loader,
  { name = null, onTooLarge = null, onMissing = null } = {}
) {
  try {
    return await loader();
  } catch (err) {
    if (handleOptionalArtifactFallback(err, { name, onTooLarge, onMissing })) {
      return null;
    }
    throw err;
  }
}

/**
 * Wrap an optional async iterable loader and suppress expected missing/too-large
 * failures while preserving stream shape.
 *
 * @param {() => Promise<AsyncIterable<any>|null>} loader
 * @param {{name?:string|null,onTooLarge?:(name:string|null,err:any)=>void,onMissing?:(name:string|null,err:any)=>void}} [options]
 * @returns {AsyncIterable<any>}
 */
export function iterateOptionalWithFallback(
  loader,
  { name = null, onTooLarge = null, onMissing = null } = {}
) {
  return (async function* iterateOptionalRows() {
    try {
      const rows = await loader();
      if (!rows) return;
      for await (const row of rows) {
        yield row;
      }
    } catch (err) {
      if (handleOptionalArtifactFallback(err, { name, onTooLarge, onMissing })) {
        return;
      }
      throw err;
    }
  })();
}
