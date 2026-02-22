import fsSync from 'node:fs';
import path from 'node:path';
import { pathExists } from './files.js';
import {
  MAX_JSON_BYTES,
  loadPiecesManifest,
  resolveArtifactPresence
} from './artifact-io.js';

const CHUNK_META_LEGACY_CANDIDATES = [
  'chunk_meta.json',
  'chunk_meta.jsonl',
  'chunk_meta.meta.json',
  'chunk_meta.columnar.json',
  'chunk_meta.binary-columnar.meta.json'
];

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

const hasManifestChunkMetaArtifacts = (dir) => {
  try {
    const manifest = loadPiecesManifest(dir, { maxBytes: MAX_JSON_BYTES, strict: true });
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
  } catch {
    return false;
  }
};

export function hasChunkMetaArtifactsSync(dir) {
  if (!dir) return false;
  for (const relPath of CHUNK_META_LEGACY_CANDIDATES) {
    if (hasArtifactFileSync(path.join(dir, relPath))) return true;
  }
  if (fsSync.existsSync(path.join(dir, 'chunk_meta.parts'))) return true;
  return hasManifestChunkMetaArtifacts(dir);
}

export async function hasChunkMetaArtifactsAsync(dir) {
  if (!dir) return false;
  for (const relPath of CHUNK_META_LEGACY_CANDIDATES) {
    if (await hasArtifactFileAsync(path.join(dir, relPath))) return true;
  }
  if (await pathExists(path.join(dir, 'chunk_meta.parts'))) return true;
  return hasManifestChunkMetaArtifacts(dir);
}

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
