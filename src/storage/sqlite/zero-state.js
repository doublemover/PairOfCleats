import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ARTIFACT_SURFACE_VERSION } from '../../contracts/versioning.js';
import { MAX_JSON_BYTES } from '../../shared/artifact-io/constants.js';
import { resolveArtifactPath } from '../../shared/artifact-io/contained-path.js';
import { readVerifiedContainedFile } from '../../shared/contained-file.js';
import { stableStringify } from '../../shared/stable-json.js';
import { loadChunkMeta } from '../../shared/artifact-io/loaders/chunk-meta.js';

export const SQLITE_ZERO_STATE_SCHEMA_VERSION = '1.1.0';
const invalid = message => Object.assign(new Error(message), { code: 'ERR_SQLITE_ZERO_STATE' });
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export const sqliteZeroStateChecksum = payload => sha256(stableStringify(payload));

/** Bind the waiver to selected source bytes, independently proving empty data. */
export const resolveSqliteZeroStateSourceProof = async (indexDir, mode, { identityIndexDir = null } = {}) => {
  let manifest = null;
  try {
    const { buffer } = await readVerifiedContainedFile(indexDir,
      path.join(indexDir, 'pieces', 'manifest.json'), { maxBytes: MAX_JSON_BYTES });
    const raw = JSON.parse(buffer.toString('utf8'));
    manifest = raw?.fields || raw;
    if (manifest?.artifactSurfaceVersion !== ARTIFACT_SURFACE_VERSION
      || (manifest.mode != null && manifest.mode !== mode) || !Array.isArray(manifest.pieces)) {
      throw invalid('Zero-state source manifest identity is invalid.');
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const sources = manifest
    ? manifest.pieces.filter(piece => piece?.name === 'chunk_meta'
      || piece?.name?.startsWith('chunk_meta_') || piece?.name?.startsWith('dense_vectors'))
    : [{ name: 'chunk_meta', path: 'chunk_meta.json', format: 'json' }];
  if (!sources.some(piece => piece.name === 'chunk_meta')) throw invalid('Zero-state source has no chunk metadata.');
  if (!manifest) {
    const names = await fs.readdir(indexDir);
    if (names.some(name => name.startsWith('dense_vectors'))) {
      throw invalid('Legacy zero-state source cannot prove dense artifact absence.');
    }
  }
  const identities = [];
  for (const piece of sources) {
    const target = resolveArtifactPath(indexDir, piece.path);
    const { buffer } = await readVerifiedContainedFile(indexDir, target, { maxBytes: MAX_JSON_BYTES });
    identities.push({ name: piece.name, path: piece.path, hash: sha256(buffer) });
    if (!piece.name.startsWith('dense_vectors') || /offsets|hnsw|lancedb/.test(piece.name)) continue;
    if (piece.count != null && piece.count !== 0) throw invalid('Zero-state dense source has rows.');
    if (/\.jsonl(?:$|\.)/.test(piece.path) || piece.format === 'bin') {
      if (piece.format === 'bin' ? buffer.length !== 0 : buffer.toString('utf8').trim() !== '') {
        throw invalid('Zero-state dense payload is not empty.');
      }
    } else if (/\.json$/.test(piece.path)) {
      const raw = JSON.parse(buffer.toString('utf8'));
      const meta = raw?.fields || raw;
      const counts = [meta?.count, meta?.totalRecords].filter(value => value != null);
      if (!counts.length || counts.some(count => count !== 0)
        || (Array.isArray(meta.vectors) && meta.vectors.length)
        || (Array.isArray(meta.parts) && meta.parts.some(part => typeof part !== 'object' || part.records !== 0))) {
        throw invalid('Zero-state dense metadata does not prove zero rows.');
      }
    } else {
      throw invalid('Zero-state dense encoding cannot be independently verified.');
    }
  }
  if (manifest) {
    const rows = await loadChunkMeta(indexDir, { manifest, strict: true, maxBytes: MAX_JSON_BYTES });
    if (!Array.isArray(rows) || rows.length !== 0) throw invalid('Zero-state chunk metadata is not empty.');
  } else {
    const { buffer } = await readVerifiedContainedFile(indexDir, path.join(indexDir, 'chunk_meta.json'), { maxBytes: MAX_JSON_BYTES });
    const rows = JSON.parse(buffer.toString('utf8'));
    if (!Array.isArray(rows) || rows.length !== 0) throw invalid('Legacy zero-state chunk metadata is not empty.');
  }
  identities.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return sqliteZeroStateChecksum({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    buildId: manifest?.buildId || null, compatibilityKey: manifest?.compatibilityKey || null,
    mode, indexDir: identityIndexDir ?? path.resolve(indexDir), sources: identities });
};

export const validateSqliteZeroStateManifest = async ({ indexDir, mode, outputPath, payload }) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw invalid('Zero-state marker is invalid.');
  const { checksum, ...body } = payload;
  if (body.schemaVersion !== SQLITE_ZERO_STATE_SCHEMA_VERSION
    || body.artifactSurfaceVersion !== ARTIFACT_SURFACE_VERSION
    || body.mode !== mode || body.chunkCount !== 0 || body.denseCount !== 0
    || body.indexDir !== path.resolve(indexDir) || body.outputPath !== path.resolve(outputPath)
    || typeof checksum !== 'string' || checksum !== sqliteZeroStateChecksum(body)) {
    throw invalid('Zero-state marker schema, checksum, or mode identity is invalid.');
  }
  const sourceProof = await resolveSqliteZeroStateSourceProof(indexDir, mode);
  if (body.sourceProof !== sourceProof) throw invalid('Zero-state source generation changed.');
  return true;
};
