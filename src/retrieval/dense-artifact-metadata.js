import { createHash } from 'node:crypto';
import { MAX_JSON_BYTES } from '../shared/artifact-io/constants.js';
import { resolveArtifactPresence, resolveManifestArtifactSources } from '../shared/artifact-io/manifest.js';
import { resolveManifestPieceByPath } from '../shared/artifact-io/manifest-sources.js';
import { loadJsonObjectArtifact } from '../shared/artifact-io/loaders/core.js';
import { resolveReadableArtifactPath } from '../shared/artifact-io/loaders/core-source-resolution.js';
import { readBuffer, detectCompression, decompressBuffer } from '../shared/artifact-io/compression.js';

/** Optional absence can select another dense family; declared failures cannot.
 * A checksum is checked against the exact bounded bytes parsed below, never an
 * independent earlier read or a stat-only cache observation. */
export const loadDenseArtifactMetadata = async (dir, name, { manifest, strict, maxBytes = MAX_JSON_BYTES }) => {
  if (!strict) return loadJsonObjectArtifact(dir, name, { manifest, strict, maxBytes });
  const presence = resolveArtifactPresence(dir, name, { manifest, strict, maxBytes });
  if (presence.error) {
    if (presence.error.code === 'ERR_MANIFEST_MISSING' || presence.error.code === 'ERR_MANIFEST_ENTRY_MISSING') return null;
    throw presence.error;
  }
  if (presence.format === 'missing') return null;
  const sources = resolveManifestArtifactSources({ dir, manifest, name, strict, maxBytes });
  if (sources.format !== 'json' || sources.paths.length !== 1)
    return loadJsonObjectArtifact(dir, name, { manifest, strict, maxBytes });
  const target = sources.paths[0];
  const piece = resolveManifestPieceByPath({ dir, manifest, targetPath: target, expectedName: name });
  if (piece?.checksum == null) return loadJsonObjectArtifact(dir, name, { manifest, strict, maxBytes });
  const match = typeof piece.checksum === 'string' && /^(sha1|sha256|xxh64):([a-f0-9]+)$/i.exec(piece.checksum);
  const lengths = { sha1: 40, sha256: 64, xxh64: 16 };
  const algorithm = match && match[1].toLowerCase();
  if (!match || match[2].length !== lengths[algorithm]) throw Object.assign(
    new Error('Invalid manifested checksum for dense metadata ' + name), { code: 'ERR_MANIFEST_INVALID' });
  const filename = resolveReadableArtifactPath(target);
  const bytes = readBuffer(filename, maxBytes, { containedRoot: dir });
  let actual;
  if (algorithm === 'xxh64') {
    const { createXxhash64Hasher } = await import('../shared/hash/xxhash-backend.js');
    const hasher = await createXxhash64Hasher(); hasher.update(bytes); actual = hasher.digest();
  } else actual = createHash(algorithm).update(bytes).digest('hex');
  if (actual !== match[2].toLowerCase()) throw Object.assign(
    new Error('Manifested dense metadata checksum mismatch: ' + name), { code: 'ERR_ARTIFACT_CORRUPT' });
  return JSON.parse(decompressBuffer(bytes, detectCompression(filename), maxBytes, filename).toString('utf8'));
};
